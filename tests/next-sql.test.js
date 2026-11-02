'use strict';
/*
 * EquipRite Next · the SQL worksheet:
 *   resources/js/sqlWorksheet.js   statements split as SQL Developer splits them, the one under the cursor, the grid,
 *                                  the connection form (SQL Developer's New / Select Database Connection)
 *   desktop/lib/oracleSql.js       connections kept on this PC (passwords encrypted, never sent back), connect strings
 *                                  (Basic with SID or service name, TNS alias, connect identifier), Test, Connect, run
 *                                  (a query in pages, a change waiting for Commit, DDL, PL/SQL with DBMS output),
 *                                  read only, disconnect rolls back. With a fake driver (tests/e2e/fake-oracle.js).
 *   desktop/lib/devserver.js       /__sql/* only from this PC and only with the X-EquipRite-SQL header.
 * Run: node tests/next-sql.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const http = require('http');
const H = require('./_harness');
const { fakeOracle } = require('./e2e/fake-oracle');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
function loadAmd(file) {
  let mod;
  const sb = { console, define: (d, f) => { mod = f(); } };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(file, 'utf8'), sb, { filename: file });
  return mod;
}
const W = loadAmd(path.join(ROOT, 'webApps', 'equiprite-next', 'resources', 'js', 'sqlWorksheet.js'));
const S = require('../desktop/lib/oracleSql');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqr-sql-'));
const json = (x) => JSON.stringify(x);

(async () => {
  T.section('statements, as SQL Developer splits them');
  const script = "select 'a;b' x, q'[it's;]' y from dual;\n-- a note; with a semicolon\nupdate emp set sal = sal + 1 where ename = 'O''Brien;';\n\nbegin\n  dbms_output.put_line('hi;');\nend;\n/\ncreate or replace procedure p as begin null; end;\n/\nselect a / 2 from t";
  const st = W.split(script);
  T.eq('five statements: quotes, q-quotes, comments and PL/SQL blocks respected', st.map((x) => x.line + ':' + W.kindOf(x.text)).join(' '), '1:query 2:dml 5:plsql 9:plsql 11:query');
  T.eq('…a block keeps its END; and its inner ;', st[2].text, "begin\n  dbms_output.put_line('hi;');\nend;");
  T.eq('…a division is not a "/" line', st[4].text, 'select a / 2 from t');
  T.eq('the statement under the cursor; after the last, the last', [W.atCursor(script, script.indexOf('sal + 1')).line, W.atCursor(script, script.length).line, W.atCursor('  ', 1)].join(), '2,11,');
  T.eq('kinds', ['with x as (select 1 from dual) select * from x', 'merge into t using s on (1=1) when matched then update set a=1', 'truncate table t', 'commit', 'exec p(1)', 'create table t (a number)']
    .map(W.kindOf).join(), 'query,dml,ddl,tx,plsql,ddl');

  T.section('the grid');
  const g = W.grid([{ name: 'EMPNO', type: 'NUMBER' }, { name: 'ENAME', type: 'VARCHAR2' }, { name: 'HIRED', type: 'DATE' }], [[7369, 'SMITH', '2026-01-01 09:30:00'], [7499, null, 'x'.repeat(250)]]);
  T.eq('row numbers, (null), numbers to the right, long text cut', [g.rows.map((r) => r.n).join(), g.rows[1].cells[1].t, g.rows[0].cells[0].cls, g.rows[1].cells[2].t.length, g.rows[1].cells[2].full.length].join(' | '),
    '1,2 | (null) | nx-sql-num | 201 | 250');
  T.eq('…a column per field after the row number', g.style.gridTemplateColumns, '52px minmax(72px, 200px) minmax(96px, 320px) minmax(96px, 320px)');
  T.eq('export: the rows as exportKit takes them', json(W.exportSpec([{ name: 'A', type: 'NUMBER' }], [[1], [null]])), '{"columns":[{"key":"c0","label":"A","type":"number"}],"rows":[{"c0":1},{"c0":null}]}');

  T.section('the connection form (SQL Developer\'s fields)');
  let f = W.blankForm();
  T.eq('what is missing before Test, in words', W.missing(f, false), 'Give the username, the password, the hostname and the service name.');
  f = W.setField(W.setField(W.setField(W.setField(f, 'username', 'equiprite'), 'password', 'secret'), 'host', '10.1.2.3'), 'service', 'devdb');
  f = W.setField(f, 'port', '15a21');
  T.eq('…complete; the port keeps digits; details as the list shows them', [W.missing(f, false), f.port, W.details(f)].join(' | '), ' | 1521 | equiprite@10.1.2.3:1521/devdb');
  T.eq('…to save it needs a name', W.missing(f, true), 'Give a name.');
  T.eq('SID, TNS alias and connect identifier details', [W.details(Object.assign({}, f, { sidType: 'sid', sid: 'ORCL' })), W.details(Object.assign({}, f, { type: 'tns', tnsAlias: 'DEVDB' })),
    W.details(Object.assign({}, f, { type: 'custom', connectString: 'db:1521/x' }))].join(' ; '), 'equiprite@10.1.2.3:1521:ORCL ; equiprite@DEVDB ; equiprite@db:1521/x');
  T.eq('a saved connection in the form: its password never comes back', [W.formOf({ id: 'a', name: 'devdb', hasPassword: true, password: 'leak' }).password, W.formOf({ id: 'a', hasPassword: true }).hasPassword].join(), ',true');
  const hist = W.remember(W.remember([], { at: '2026-11-02T10:00:00Z', conn: 'devdb', sql: 'select 1 from dual', kind: 'query', ok: true, outcome: '1 row fetched' }),
    { at: '2026-11-02T10:01:00Z', conn: 'devdb', sql: 'select 1 from dual', kind: 'query', ok: true, outcome: '1 row fetched' });
  T.eq('history: the same statement once, newest first', [hist.length, W.historyRows(hist)[0].when].join(' | '), '1 | 2026-11-02 10:01');

  T.section('connect strings (desktop/lib/oracleSql.js)');
  T.eq('Basic, service name: EZConnect', S.connectSpec({ host: 'h', port: '1521', service: 'devdb' }).connectString, 'h:1521/devdb');
  T.eq('Basic, SID: a descriptor', S.connectSpec({ host: 'h', port: '1521', sidType: 'sid', sid: 'ORCL' }).connectString, '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=h)(PORT=1521))(CONNECT_DATA=(SID=ORCL)))');
  T.eq('TNS: the alias, and the folder of tnsnames.ora', json(S.connectSpec({ type: 'tns', tnsAlias: 'DEVDB', tnsAdmin: 'C:\\oracle\\admin' })), '{"connectString":"DEVDB","configDir":"C:\\\\oracle\\\\admin","text":"DEVDB (C:\\\\oracle\\\\admin)"}');
  T.eq('tnsnames.ora aliases (comments and nesting skipped)', S.parseTns('# x\nDEVDB =\n (DESCRIPTION = (ADDRESS = (HOST = h)(PORT = 1521)) (CONNECT_DATA = (SERVICE_NAME = p)))\nA1, A2.WORLD=(DESCRIPTION=(ADDRESS=(HOST=x)))').join(), 'A1,A2.WORLD,DEVDB');
  let bad = '';
  try { S.connectSpec({ host: 'h', port: '99999', service: 's' }); } catch (e) { bad = e.message; }
  T.eq('a wrong port, in words', bad, 'The port must be a number from 1 to 65535.');

  T.section('connections kept on this PC: the password encrypted, never sent back');
  const D = fakeOracle({ password: 'secret' });
  const file = path.join(tmp, 'sql-connections.json');
  const enc = (t) => Buffer.from('ENC:' + Buffer.from(t).toString('base64'));
  const dec = (b) => Buffer.from(b.toString().slice(4), 'base64').toString();
  const store = await S.open({ file, driver: D, encrypt: enc, decrypt: dec });
  const saved = store.save({ name: 'devdb', username: 'equiprite', password: 'secret', host: '10.1.2.3', port: '1521', service: 'devdb', savePassword: true });
  const onDisk = fs.readFileSync(file, 'utf8');
  T.check('saved: the password is not on disk as text, it is the keychain\'s', !onDisk.includes('secret') && onDisk.includes('"password"') && saved.passwordKept === 'keychain', onDisk);
  T.eq('the list: details, a password kept, but never the password', json(store.list().map((c) => [c.name, c.details, c.hasPassword, c.password === undefined])), '[["devdb","equiprite@10.1.2.3:1521/devdb",true,true]]');
  let clash = '';
  try { store.save({ name: 'DEVDB', username: 'x', host: 'h', service: 's' }); } catch (e) { clash = e.message; }
  T.eq('two connections cannot share a name', clash, 'A connection called "devdb" exists already.');
  const noKey = await S.open({ file: path.join(tmp, 'nokey.json'), driver: D });
  const nk = noKey.save({ name: 'x', username: 'u', password: 'secret', host: 'h', service: 's' });
  T.check('no keychain on the PC: the password is kept for this run only, never written', nk.passwordKept.startsWith('this run') && !fs.readFileSync(path.join(tmp, 'nokey.json'), 'utf8').includes('secret')
    && noKey.list()[0].hasPassword);
  const noSave = store.save({ name: 'asked', username: 'u', password: 'secret', host: 'h', service: 's', savePassword: false });
  T.eq('"Save Password" off: kept for this run only', noSave.passwordKept, 'this run');

  T.section('Test and Connect, as SQL Developer has them');
  const id = saved.id;
  let t = await store.test({ id });
  T.eq('Test with the saved password: success, the banner, the user', [t.ok, t.user, t.banner.slice(0, 18), t.target].join(' | '), 'true | EQUIPRITE | Oracle Database 19 | 10.1.2.3:1521/devdb');
  t = await store.test({ id, password: 'wrong' });
  T.check('a wrong password: the database\'s words, and what it means', !t.ok && /ORA-01017.*\(wrong username or password\)/.test(t.error), t.error);
  t = await (await S.open({ file: path.join(tmp, 'down.json'), driver: fakeOracle({ down: true }) })).test({ name: 'd', username: 'u', password: 'p', host: 'nowhere', service: 's' });
  T.check('nothing listening: said, with what to check', !t.ok && /NJS-503[\s\S]*check the hostname, the port and the VPN/.test(t.error), t.error);
  const c = await store.connect({ id });
  T.eq('connected: a session, the user, where', [!!c.session, c.user, c.target, c.readOnly].join(' | '), 'true | EQUIPRITE | 10.1.2.3:1521/devdb | false');
  T.eq('…the connect string the database got', json(D.calls.filter((x) => x.op === 'connect').pop()), '{"op":"connect","user":"equiprite","connectString":"10.1.2.3:1521/devdb","configDir":"","privilege":0}');

  T.section('running SQL');
  let r = await store.run(c.session, 'select * from emp;', { fetch: 200 });
  T.eq('a query: its columns, the first 200 rows, more to fetch', [r.kind, r.columns.map((x) => x.name + ':' + x.type).join(), r.rows.length, r.more].join(' | '), 'query | EMPNO:NUMBER,ENAME:VARCHAR2,SAL:NUMBER,HIREDATE:DATE | 200 | true');
  T.eq('…dates as stored (this PC\'s time), nulls as null', [r.rows[0][3], r.rows[0][2]].join('|'), '2026-01-01 09:30:00|');
  T.eq('…its ";" taken off before it reached the database', D.calls.filter((x) => x.op === 'execute').pop().sql, 'select * from emp');
  let m = await store.more(c.session, 200);
  const m2 = await store.more(c.session, 200);
  T.eq('fetch more: 200, then the last 50', [m.rows.length, m.more, m2.rows.length, m2.more].join(), '200,true,50,false');
  r = await store.run(c.session, 'update emp set sal = sal + 1', {});
  T.eq('a change: rows affected, not committed', [r.kind, r.rowsAffected, r.message, r.pending].join(' | '), 'dml | 2 | 2 rows updated. | true');
  T.eq('…the session says so', store.sessions()[0].pending, true);
  r = await store.commit(c.session);
  T.eq('Commit', [r.message, store.sessions()[0].pending, D.calls.filter((x) => x.op === 'commit').pop().pending].join(' | '), 'Commit complete. | false | 2');
  r = await store.run(c.session, "begin\n  dbms_output.put_line('Hello');\nend;\n/", {});
  T.eq('PL/SQL: done, with its DBMS output', [r.kind, r.message, r.output.join(' / ')].join(' | '), 'plsql | PL/SQL procedure successfully completed. | Hello from PL/SQL / Second line');
  T.eq('…the block reached the database whole, without the "/"', D.calls.filter((x) => x.op === 'execute' && /put_line/.test(x.sql)).pop().sql, "begin\n  dbms_output.put_line('Hello');\nend;");
  let err = '';
  try { await store.run(c.session, 'select * from nope', {}); } catch (e) { err = e.message; }
  T.eq('an error: the database\'s words', err, 'ORA-00942: table or view does not exist');
  r = await store.run(c.session, 'delete from emp where 1=0', {});
  const d = await store.disconnect(c.session);
  T.eq('Disconnect with changes pending: rolled back, and said', [d.message, D.calls.filter((x) => x.op === 'rollback').pop().pending].join(' | '), 'Disconnected: the uncommitted changes were rolled back. | 3');
  err = '';
  try { await store.run(c.session, 'select 1 from dual', {}); } catch (e) { err = e.message; }
  T.eq('…the session is gone', err, 'Not connected (the session ended). Connect again.');

  T.section('a read-only connection');
  const ro = store.save({ name: 'reports', username: 'equiprite', password: 'secret', host: 'h', service: 's', readOnly: true });
  const rc = await store.connect({ id: ro.id });
  r = await store.run(rc.session, 'select 1 from dual', {});
  err = '';
  try { await store.run(rc.session, 'update emp set sal = 0', {}); } catch (e) { err = e.message; }
  T.eq('queries run; a change is refused before the database sees it', [r.rows.length, err].join(' | '), '1 | This connection is read only: only queries run (SELECT or WITH). Edit the connection to allow changes.');
  T.check('…the update never reached the database', !D.calls.some((x) => x.op === 'execute' && /set sal = 0/.test(x.sql)));
  await store.close();

  T.section('tnsnames.ora in a folder');
  fs.writeFileSync(path.join(tmp, 'tnsnames.ora'), 'DEVDB = (DESCRIPTION = (ADDRESS = (PROTOCOL = TCP)(HOST = h)(PORT = 1521))(CONNECT_DATA = (SERVICE_NAME = devdb)))\n');
  T.eq('the aliases in it', json(store.tnsAliases(tmp).aliases), '["DEVDB"]');
  T.check('no tnsnames.ora: said', /No tnsnames.ora/.test(store.tnsAliases(path.join(tmp, 'none')).note));

  T.section('/__sql/* only for EquipRite Next on this PC');
  const build = path.join(tmp, 'build');
  fs.mkdirSync(path.join(build, 'processed', 'webApps', 'equiprite-next'), { recursive: true });
  fs.writeFileSync(path.join(build, 'processed', 'webApps', 'equiprite-next', 'index.html'), '<html></html>');
  const DS = require('../desktop/lib/devserver');
  const live = await S.open({ file: path.join(tmp, 'srv.json'), driver: fakeOracle() });
  const srv = await DS.createDevServer({ buildDir: build, webApp: 'equiprite-next', port: 0, getIdentity: () => null, sqlStore: live, onLog: () => {} });
  const req = (p, o) => new Promise((resolve) => {
    const rq = http.request({ host: '127.0.0.1', port: srv.port, path: p, method: (o && o.method) || 'GET', headers: Object.assign({ Host: 'localhost:' + srv.port }, (o && o.headers) || {}) }, (res) => {
      let b = '';
      res.on('data', (x) => { b += x; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    if (o && o.body) rq.write(o.body);
    rq.end();
  });
  const H1 = { 'X-EquipRite-SQL': '1' };
  T.eq('with the header: the info', JSON.parse((await req('/__sql/info', { headers: H1 })).body).engine, 'oracledb');
  T.eq('without it (another site\'s page): refused', (await req('/__sql/info')).status, 403);
  T.eq('from another site\'s origin, even with it: refused', (await req('/__sql/connections', { headers: Object.assign({ Origin: 'http://evil.example' }, H1) })).status, 403);
  T.eq('by another name than this PC\'s: not found', (await req('/__sql/info', { headers: Object.assign({}, H1, { Host: 'evil.example' }) })).status, 404);
  const saveRes = await req('/__sql/connections', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json', Origin: 'http://localhost:' + srv.port }, H1),
    body: JSON.stringify({ name: 'devdb', username: 'equiprite', password: 'secret', host: 'h', service: 's' }) });
  T.check('a save from the app\'s own page answers without the password', saveRes.status === 200 && !saveRes.body.includes('secret'), saveRes.body);
  const runRes = await req('/__sql/run', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, H1), body: JSON.stringify({ session: 'nope', sql: 'select 1 from dual' }) });
  T.eq('a run on an unknown session: answered, in words (a database refusal is data, not a failed call)', [runRes.status, JSON.parse(runRes.body).error].join(' | '), '200 | Not connected (the session ended). Connect again.');
  await srv.close();
  await live.close();

  T.report();
})();
