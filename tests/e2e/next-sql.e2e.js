'use strict';
/*
 * EquipRite Next, the SQL worksheet, in a real browser with the desktop app's SQL store (desktop/lib/oracleSql.js) over
 * a fake Oracle driver (tests/e2e/fake-oracle.js): New connection as in SQL Developer (Test with a wrong password,
 * then right; Save; Connect), Ctrl+Enter runs the statement under the cursor, the grid and Fetch more, a change waits
 * for Commit, a script with PL/SQL and DBMS output, an error in the database's words, the history, the password never
 * in the page or on disk, and nothing for another site. Needs `npm run build`. Run: node tests/e2e/next-sql.e2e.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const E = require('./harness');
const H = require('../_harness');
const { fakeOracle } = require('./fake-oracle');

const T = H.makeAsserter();

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqr-sql-e2e-'));
  const D = fakeOracle({ password: 'secret' });
  const enc = (t) => Buffer.from('ENC:' + Buffer.from(t).toString('base64'));
  const dec = (b) => Buffer.from(b.toString().slice(4), 'base64').toString();
  const sqlStore = await require('../../desktop/lib/oracleSql').open({ file: path.join(tmp, 'sql-connections.json'), driver: D, encrypt: enc, decrypt: dec });
  // Ask AI over a fake LLM (Anthropic's API shape): its models, and an answer with SQL.
  const aiCalls = [];
  const aiFetch = async (url, init) => {
    const i = init || {};
    aiCalls.push({ url, headers: i.headers || {}, body: i.body ? JSON.parse(i.body) : null });
    const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
    if (/\/v1\/models/.test(url)) return json({ data: [{ id: 'model-b', display_name: 'Model B' }, { id: 'model-a', display_name: 'Model A' }] });
    if (/\/v1\/messages/.test(url)) return json({ content: [{ type: 'text', text: '```sql\nselect e.empno, e.ename from emp e where e.sal is null\n```\nEmployees with no salary recorded.' }] });
    return { ok: false, status: 404, text: async () => '{}' };
  };
  const aiStore = await require('../../desktop/lib/aiSql').open({ file: path.join(tmp, 'ai-settings.json'), encrypt: enc, decrypt: dec, fetch: aiFetch });
  const env = await E.start({ port: 19730, app: 'next', sqlStore, aiStore, username: 'javeed.shaik' });
  const { page } = env;
  const text = async (sel) => ((await page.$(sel)) ? env.text(sel) : '');
  try {
    T.section('the SQL menu, and a worksheet with no connection yet');
    await env.open('/?open=sql');
    await page.waitForSelector('#page-sql #sqlNoConns', { timeout: 30000 });
    T.check('SQL is in the Admin menu', await page.$('.nx-nav-item[data-nav-id="sql"]') !== null);
    T.eq('nothing connected yet', await text('#sqlNotConnected'), 'Not connected: choose Connect beside a connection');
    T.eq('fetches 200 rows at a time, as the box says', await page.inputValue('#sqlFetch'), '200');
    T.check('where the connections are kept, said', (await text('#sqlWhere')).startsWith('Saved on this PC in ') && (await text('#sqlWhere')).includes('sql-connections.json'), await text('#sqlWhere'));
    T.check('the driver said: Thin, no Oracle client; passwords encrypted', /node-oracledb 6\.10\.0, Thin mode .*encrypted by the operating system/.test(await text('#sqlEngine')), await text('#sqlEngine'));

    T.section('New / Select Database Connection, as in SQL Developer');
    await page.click('#sqlNewConn');
    await page.waitForSelector('#sqlDialog');
    T.eq('its fields', await page.$$eval('#sqlDialog label, #sqlDialog .nx-sql-lbl, #sqlDialog legend', (l) => l.map((x) => x.innerText.trim()).filter(Boolean).join(' | ')),
      'Name | Database Type | User Info | Authentication Type | Username | Role | Password | Save Password | Connection Type | Details | Hostname | Port | SID | Service name');
    await page.click('#sqlDlgTest');
    await page.waitForTimeout(200);
    T.eq('Test before anything is given: what is missing', await text('#sqlDlgStatus'), 'Status : Give the username, the password, the hostname and the service name.');
    await page.fill('#sqlName', 'devdb');
    await page.fill('#sqlUser', 'equiprite');
    await page.fill('#sqlPassword', 'wrong');
    await page.fill('#sqlHost', '10.1.2.3');
    await page.fill('#sqlService', 'devdb');
    await page.click('#sqlDlgTest');
    await page.waitForFunction(() => /Failure/.test(document.getElementById('sqlDlgStatus').innerText), null, { timeout: 10000 });
    T.check('a wrong password: Failure, in the database\'s words', /Status : Failure: ORA-01017.*wrong username or password/.test(await text('#sqlDlgStatus')), await text('#sqlDlgStatus'));
    await page.fill('#sqlPassword', 'secret');
    await page.click('#sqlDlgTest');
    await page.waitForFunction(() => /Success/.test(document.getElementById('sqlDlgStatus').innerText), null, { timeout: 10000 });
    T.check('Test: Success, who, where, the banner', /^Status : Success\. EQUIPRITE @ 10\.1\.2\.3:1521\/devdb · Oracle Database 19c/.test(await text('#sqlDlgStatus')), await text('#sqlDlgStatus'));
    await page.click('#sqlDlgSave');
    await page.waitForFunction(() => /Saved/.test(document.getElementById('sqlDlgStatus').innerText), null, { timeout: 10000 });
    T.eq('Saved, the password encrypted', await text('#sqlDlgStatus'), 'Status : Saved "devdb": the password is encrypted on this PC.');
    T.eq('…listed as SQL Developer lists it', await page.$$eval('#sqlDlgList .nx-sql-dlglist-row', (r) => r.map((x) => x.innerText.replace(/\s+/g, ' ').trim()).join()), 'devdb equiprite@10.1.2.3:1521/devdb');
    T.check('…the password field is empty again, the saved one kept', (await page.inputValue('#sqlPassword')) === '' && (await page.getAttribute('#sqlPassword', 'placeholder')) === 'Saved: leave empty to keep it');
    await page.selectOption('#sqlType', 'tns');
    await page.waitForSelector('#sqlTnsDir');
    T.check('TNS: the folder of tnsnames.ora and the network alias', !!(await page.$('#sqlAlias')) && /TNS_ADMIN is not set|tnsnames/.test(await text('#sqlTnsNote')), await text('#sqlTnsNote'));
    await page.selectOption('#sqlType', 'basic');
    await page.waitForSelector('#sqlHost');
    await env.shot('next-sql-connection.png');
    await page.click('#sqlDlgConnect');
    await page.waitForSelector('#sqlDialog', { state: 'detached', timeout: 10000 });
    await page.waitForSelector('#sqlConnected');
    T.eq('connected: name, user, where', await text('#sqlConnected'), 'devdb · EQUIPRITE · 10.1.2.3:1521/devdb');

    T.section('Connect without Save: the connection is kept, as in SQL Developer');
    await page.click('#sqlNewConn');
    await page.waitForSelector('#sqlDialog');
    T.eq('a new dialog starts empty (the inputs too)', [await page.inputValue('#sqlName'), await page.inputValue('#sqlUser'), await page.inputValue('#sqlHost')].join('|'), '||');
    await page.fill('#sqlUser', 'equiprite');
    await page.fill('#sqlPassword', 'secret');
    await page.fill('#sqlHost', '10.1.2.3');
    await page.fill('#sqlService', 'devdb');
    await page.click('#sqlDlgConnect');
    await page.waitForSelector('#sqlDialog', { state: 'detached', timeout: 10000 });
    await page.waitForFunction(() => /^equiprite@devdb/.test(document.getElementById('sqlConnected').innerText), null, { timeout: 10000 });
    T.eq('connected, named for it', await text('#sqlConnected'), 'equiprite@devdb · EQUIPRITE · 10.1.2.3:1521/devdb');
    T.eq('…and in the list, beside the saved one, marked connected', await page.$$eval('#sqlConnList .nx-sql-conn', (l) => l.map((x) => x.querySelector('.nx-sql-conn-name').innerText.trim()
      + (x.className.includes('--on') ? '*' : '')).join(', ')), 'devdb, equiprite@devdb*');
    T.eq('…the panel counts them', await text('#sqlConnsTitle'), 'Connections (2)');

    T.section('the Connections panel folds away, and stays folded');
    const wide = async () => page.$eval('#page-sql .nx-sql-work', (e) => Math.round(e.getBoundingClientRect().width));
    const before = await wide();
    await page.click('#sqlConnsHide');
    await page.waitForSelector('#sqlConnsShow');
    T.check('folded to a rail; the worksheet takes the width', (await text('#sqlConnsShow')) === 'Connections · 2' && (await wide()) > before + 150, (await wide()) + ' vs ' + before);
    await env.shot('next-sql-folded.png');
    await env.open('/?open=sql');
    await page.waitForSelector('#sqlConnsShow', { timeout: 30000 });
    T.check('opened again: still folded, still connected', (await text('#sqlConnected')).startsWith('equiprite@devdb'));
    await page.click('#sqlConnsShow');
    await page.waitForSelector('#sqlConnList');
    T.check('shown again', await page.isVisible('#sqlConnsHide'));

    T.section('Ask AI: choose the LLM and its key, then ask in plain words');
    T.eq('no LLM chosen yet', await text('#sqlAiWho'), 'Choose the LLM…');
    await page.fill('#sqlAiAsk', 'employees without a salary');
    await page.press('#sqlAiAsk', 'Enter');
    await page.waitForSelector('#sqlAiDialog', { timeout: 10000 });
    T.eq('asking first opens the choice, and says why', await text('#sqlAiStatus'), 'Status : Choose the LLM and a model first, then ask again.');
    T.eq('the LLMs to choose from', await page.$$eval('#sqlAiProviders .nx-sql-aiprov-card strong', (c) => c.map((x) => x.innerText.trim()).join(' | ')),
      'Claude (Anthropic) | ChatGPT (OpenAI) | Oracle OCI Generative AI | Google Gemini | Other (OpenAI-compatible)');
    await page.click('#sqlAiProviders [data-value="oci"]');
    await page.waitForSelector('#sqlAiF-compartmentId');
    T.eq('Oracle OCI asks for its tenancy and signing key', await page.$$eval('#sqlAiDialog .nx-sql-form label', (l) => l.map((x) => x.innerText.trim()).join(' | ')),
      'Region | Compartment OCID | Tenancy OCID | User OCID | Key fingerprint | Private key (PEM) | Key passphrase (if any) | Model');
    await page.click('#sqlAiProviders [data-value="anthropic"]');
    await page.waitForSelector('#sqlAiF-key');
    await page.fill('#sqlAiF-key', 'sk-ant-TESTKEY');
    await page.click('#sqlAiLoad');
    await page.waitForSelector('#sqlAiModels', { timeout: 10000 });
    T.eq('Load models: the models this key may use, from the provider', [await page.$$eval('#sqlAiModels .nx-sql-aimodel', (m) => m.map((x) => x.innerText.trim()).join(' ; ')), await text('#sqlAiStatus')].join(' | '),
      'Model B · model-b ; Model A · model-a | Status : Success: 2 models this key may use. Pick one, then Save.');
    T.check('…the key typed went to the desktop app; the field now says it is saved', (await page.inputValue('#sqlAiF-key')) === '' && (await page.getAttribute('#sqlAiF-key', 'placeholder')) === 'Saved: leave empty to keep it');
    await page.click('#sqlAiModels [data-value="model-a"]');
    T.eq('a model picked', await page.inputValue('#sqlAiModel'), 'model-a');
    await env.shot('next-sql-ai-settings.png');
    await page.click('#sqlAiSave');
    await page.waitForSelector('#sqlAiDialog', { state: 'detached', timeout: 10000 });
    T.eq('in use, said in the bar', await text('#sqlAiWho'), 'Claude (Anthropic) · model-a');
    await page.click('#sqlAiGo');
    await page.waitForFunction(() => /Written by/.test((document.getElementById('sqlAiNote') || {}).innerText || ''), null, { timeout: 10000 });
    const ed = await page.evaluate(() => { const e = document.getElementById('sqlEditor'); return { tail: e.value.trim().split('\n').slice(-2).join('\n'), sel: e.value.slice(e.selectionStart, e.selectionEnd) }; });
    T.eq('the SQL written into the worksheet under who wrote it, selected, not run', [ed.tail, ed.sel].join(' | '),
      '-- Ask AI (Claude (Anthropic)): employees without a salary\nselect e.empno, e.ename from emp e where e.sal is null; | select e.empno, e.ename from emp e where e.sal is null;');
    T.check('…the note: who, why, and what was sent', /^Written by Claude \(Anthropic\) · model-a in .*: Employees with no salary recorded\. Sent: your question and the names of 2 tables and their columns \(no rows\)/.test(await text('#sqlAiNote')), await text('#sqlAiNote'));
    const sent = aiCalls.filter((c) => /messages/.test(c.url)).pop().body.messages[0].content;
    T.check('the LLM got the names, never a row', sent.includes('TABLE EMP (EMPNO NUMBER, ENAME VARCHAR2, SAL NUMBER, HIREDATE DATE, DEPTNO NUMBER)') && !sent.includes('EMP 1'), sent);
    await env.shot('next-sql-ai-written.png');
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => /EMPNO/.test((document.getElementById('sqlGrid') || {}).innerText || ''), null, { timeout: 10000 });
    T.eq('Ctrl+Enter runs what it wrote', D.calls.filter((x) => x.op === 'execute' && /sal is null/.test(x.sql)).pop().sql, 'select e.empno, e.ename from emp e where e.sal is null');
    T.check('the key is in no page, storage or file as text', !(await page.evaluate(() => document.documentElement.outerHTML + JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).includes('sk-ant-TESTKEY')
      && !fs.readFileSync(path.join(tmp, 'ai-settings.json'), 'utf8').includes('sk-ant-TESTKEY'));

    T.section('Ctrl+Enter runs the statement under the cursor');
    await page.fill('#sqlEditor', 'select * from emp;\n\nupdate emp set sal = sal + 1;\n');
    await page.focus('#sqlEditor');
    await page.evaluate(() => { const e = document.getElementById('sqlEditor'); e.setSelectionRange(3, 3); });
    const mark = D.calls.length;
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('#sqlGrid', { timeout: 10000 });
    T.eq('the query ran: columns and 200 rows, more to fetch', [await page.$$eval('#sqlGrid .nx-sql-row--head .nx-sql-c', (c) => c.map((x) => x.innerText.trim()).join()),
      await page.$$eval('#sqlGrid .nx-sql-row:not(.nx-sql-row--head)', (r) => r.length), await text('#sqlTab-result')].join(' | '), '#,EMPNO,ENAME,SAL,HIREDATE | 200 | Query result (200+)');
    T.eq('…a null and a date', await page.$$eval('#sqlGrid .nx-sql-row:nth-child(2) .nx-sql-c', (c) => c.map((x) => x.innerText.trim()).join(' | ')), '1 | 7000 | EMP 1 | (null) | 2026-01-01 09:30:00');
    T.eq('…only that statement reached the database', D.calls.slice(mark).filter((x) => x.op === 'execute' && /emp/i.test(x.sql)).map((x) => x.sql).join(' ; '), 'select * from emp');
    await env.shot('next-sql-result.png');
    await page.click('#sqlMore');
    await page.waitForFunction(() => document.querySelectorAll('#sqlGrid .nx-sql-row').length === 401, null, { timeout: 10000 });
    await page.click('#sqlMore');
    await page.waitForFunction(() => !document.getElementById('sqlMore'), null, { timeout: 10000 });
    T.check('Fetch more, twice: all 450 rows, nothing more to fetch', /^Fetched 450 rows in /.test(await text('#sqlFetched')), await text('#sqlFetched'));

    T.section('a change waits for Commit');
    await page.evaluate(() => { const e = document.getElementById('sqlEditor'); const at = e.value.indexOf('update'); e.focus(); e.setSelectionRange(at + 2, at + 2); });
    await page.keyboard.press('Control+Enter');
    await page.waitForSelector('#sqlPending', { timeout: 10000 });
    T.eq('2 rows updated, not committed, and said', [await text('#sqlMessage'), await text('#sqlPending')].join(' | '),
      '2 rows updated. Not committed yet: Commit or Rollback. | Uncommitted changes in this session. Commit keeps them, Rollback undoes them; Disconnect rolls them back.');
    await page.click('#sqlCommit');
    await page.waitForSelector('#sqlPending', { state: 'detached', timeout: 10000 });
    T.eq('Commit: done, nothing pending', [await text('#sqlMessage'), D.calls.filter((x) => x.op === 'commit').length].join(' | '), 'Commit complete. | 1');

    T.section('F5 runs the script: each statement said, DBMS output, an error in the database\'s words');
    await page.fill('#sqlEditor', "begin\n  dbms_output.put_line('x');\nend;\n/\nselect * from nope;\nselect 1 from dual;");
    await page.focus('#sqlEditor');
    await page.keyboard.press('F5');
    await page.waitForFunction(() => document.querySelectorAll('#sqlScript .nx-sql-log-item').length === 3, null, { timeout: 10000 });
    T.eq('Script output: three statements, one failed', await page.$$eval('#sqlScript .nx-sql-log-item', (l) => l.map((x) => (x.className.includes('--bad') ? 'X ' : '') + x.querySelector('.nx-sql-log-out').innerText.split(' · ')[0]).join(' ; ')),
      'PL/SQL procedure successfully completed. ; X Error: ORA-00942: table or view does not exist ; 1 row fetched');
    await page.click('#sqlTab-output');
    T.eq('DBMS output, a line each', await page.$eval('#sqlOutput .nx-sql-pre', (e) => e.innerText.trim()), 'Hello from PL/SQL\nSecond line');
    await page.click('#sqlTab-history');
    T.eq('History: newest first, the error marked', await page.$$eval('#sqlHistory .nx-sql-hist-item', (h) => h.slice(0, 3).map((x) => (x.className.includes('--bad') ? 'X ' : '') + x.querySelector('code').innerText).join(' ; ')),
      "select 1 from dual ; X select * from nope ; begin dbms_output.put_line('x'); end;");
    await page.click('#sqlHistory .nx-sql-hist-item[data-index="1"]');
    T.eq('a history entry back in the worksheet', await page.inputValue('#sqlEditor'), 'select * from nope');
    await page.click('#sqlTab-result');
    await page.keyboard.press('Escape');
    await env.shot('next-sql-script.png');

    T.section('the password stays in the desktop app');
    const pageText = await page.evaluate(() => document.documentElement.outerHTML + JSON.stringify(localStorage) + JSON.stringify(sessionStorage));
    T.check('not in the page, its storage, or the connections file', !pageText.includes('secret') && !fs.readFileSync(path.join(tmp, 'sql-connections.json'), 'utf8').includes('secret'));
    const foreign = await page.evaluate(() => fetch('/__sql/connections').then((r) => r.status));
    T.eq('a call without the worksheet\'s header is refused', foreign, 403);
    for (const w of [1440, 1024]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(300);
      T.check(`${w}px: no sideways scroll on the page`, await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    let asked = '';
    page.once('dialog', (dl) => { asked = dl.message(); dl.accept(); });
    await page.click('#sqlDisconnect');
    await page.waitForSelector('#sqlNotConnected', { timeout: 10000 });
    T.eq('Disconnect after a PL/SQL block: asked first, then rolled back', [asked, D.calls.filter((x) => x.op === 'rollback').length > 0].join(' | '),
      'Disconnecting rolls back the uncommitted changes in equiprite@devdb. Disconnect? | true');
    T.eq('no browser errors', env.errors.filter((e) => !e.startsWith('warning') && !/status of 403/.test(e)).join('\n'), '');
  } catch (e) {
    T.check('run finished', false, e.stack);
    await env.shot('next-sql-failed.png').catch(() => {});
  } finally {
    await env.close();
    await sqlStore.close();
    T.report();
  }
})();
