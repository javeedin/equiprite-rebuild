'use strict';
/**
 * EquipRite Next's SQL worksheet, run by the desktop app: Oracle connections kept like SQL Developer's, SQL run against
 * them with node-oracledb in Thin mode (pure JavaScript: no Oracle client to install). Served to this PC only, at
 * /__sql/*, by lib/devserver.js (the Next server only).
 *
 *   open({ file, encrypt, decrypt, driver, now }) → store
 *     file      where the connections are kept (the app's data folder, never the project)
 *     encrypt   (text) → Buffer, decrypt (Buffer) → text: the OS keychain (Electron safeStorage). Without them a password
 *               is never written to disk: it is kept for this run only.
 *     driver    the oracledb module (tests pass a fake); loaded on first use when not given
 *
 *   info()                 { engine, version, thin, tnsAdmin, error? }
 *   list()                 the saved connections, never a password: { …, hasPassword }
 *   save(conn)             { id }: a new connection, or the saved one changed (an empty password keeps the saved one)
 *   remove(id)
 *   tnsAliases(dir)        { dir, file, aliases } read from <dir>/tnsnames.ora (TNS_ADMIN by default)
 *   test(conn)             { ok, ms, banner, user, error }: connect, read the banner, disconnect (SQL Developer's Test)
 *   connect(conn)          { session, name, user, banner, readOnly }
 *   run(session, sql, o)   one statement: { kind, columns, rows, more, rowsAffected, ms, output, pending }
 *   more(session, n)       the next rows of the open query
 *   commit / rollback / cancel / disconnect (session)
 *   sessions(), close()
 *
 * A connection: { id, name, color, username, password, savePassword, role (default|SYSDBA|SYSOPER), type
 * (basic|tns|custom), host, port, sidType (service|sid), service, sid, tnsAdmin, tnsAlias, connectString,
 * walletLocation, walletPassword, readOnly }.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FETCH = 200;            // rows a query brings at first, and each "fetch more"
const MAX_FETCH = 5000;
const IDLE_MS = 30 * 60 * 1000; // a session nobody used for 30 minutes is closed (rolled back)
const CONNECT_TIMEOUT_S = 20;

function trim(v) { return v == null ? '' : String(v).trim(); }

/** What Oracle is told to connect to, from the dialog's fields (SQL Developer's Basic, TNS and custom). */
function connectSpec(c) {
  const type = c.type || 'basic';
  if (type === 'tns') {
    if (!trim(c.tnsAlias)) throw new Error('Choose the network alias (TNS).');
    return { connectString: trim(c.tnsAlias), configDir: trim(c.tnsAdmin) || process.env.TNS_ADMIN || undefined, text: trim(c.tnsAlias) + (trim(c.tnsAdmin) ? ' (' + trim(c.tnsAdmin) + ')' : '') };
  }
  if (type === 'custom') {
    if (!trim(c.connectString)) throw new Error('Give the connect identifier: host:port/service, or a full TNS descriptor.');
    return { connectString: trim(c.connectString), text: trim(c.connectString).replace(/\s+/g, ' ').slice(0, 120) };
  }
  const host = trim(c.host);
  const port = Number(trim(c.port) || 1521);
  if (!host) throw new Error('Give the hostname.');
  if (!(port > 0 && port < 65536)) throw new Error('The port must be a number from 1 to 65535.');
  if (c.sidType === 'sid') {
    if (!trim(c.sid)) throw new Error('Give the SID.');
    return { connectString: `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=${host})(PORT=${port}))(CONNECT_DATA=(SID=${trim(c.sid)})))`, text: `${host}:${port}:${trim(c.sid)}` };
  }
  if (!trim(c.service)) throw new Error('Give the service name.');
  return { connectString: `${host}:${port}/${trim(c.service)}`, text: `${host}:${port}/${trim(c.service)}` };
}

/** The network aliases of a tnsnames.ora (the names before "=" at the top level), sorted. */
function parseTns(text) {
  const out = [];
  let depth = 0;
  let name = '';
  const src = String(text || '').replace(/#[^\n]*/g, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if (ch === '=') {
        name.split(',').map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_.\-$#]+$/.test(x)).forEach((x) => out.push(x));
        name = '';
      } else if (ch === '\n' && !name.trim()) name = '';
      else name += ch;
    }
    if (depth > 0) name = '';
  }
  return Array.from(new Set(out)).sort((a, b) => a.localeCompare(b));
}

/** What a statement is, from its first word: query, dml, ddl, plsql, tx (commit / rollback), or other. */
function kindOf(sql) {
  const s = String(sql || '').replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)+/, '').toUpperCase();
  const w = (s.match(/^[A-Z]+/) || [''])[0];
  if (w === 'SELECT' || w === 'WITH' || w === 'VALUES') return 'query';
  if (['INSERT', 'UPDATE', 'DELETE', 'MERGE'].indexOf(w) !== -1) return 'dml';
  if (w === 'BEGIN' || w === 'DECLARE' || w === 'CALL' || w === 'EXEC' || w === 'EXECUTE') return 'plsql';
  if (w === 'CREATE' && /^CREATE\s+(OR\s+REPLACE\s+)?(EDITIONABLE\s+|NONEDITIONABLE\s+)?(PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE|LIBRARY|JAVA)\b/.test(s)) return 'plsql';
  if (w === 'COMMIT' || w === 'ROLLBACK') return 'tx';
  if (['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME', 'GRANT', 'REVOKE', 'COMMENT', 'PURGE', 'FLASHBACK', 'ANALYZE', 'AUDIT', 'NOAUDIT'].indexOf(w) !== -1) return 'ddl';
  if (w === 'EXPLAIN' || w === 'LOCK' || w === 'SET' || w === 'SAVEPOINT') return 'other';
  return 'other';
}

/** The statement as Oracle takes it: SQL without its closing ";" (a PL/SQL block keeps its "END;"), no "/" line. */
function clean(sql, kind) {
  let s = String(sql || '').replace(/\n\s*\/\s*$/, '').trim();
  if (kind === 'plsql') {
    if (/^(EXEC|EXECUTE)\s+/i.test(s)) s = 'BEGIN ' + s.replace(/^(EXEC|EXECUTE)\s+/i, '').replace(/;\s*$/, '') + '; END;';
    else if (/^CALL\s+/i.test(s)) s = s.replace(/;\s*$/, '');
    return s;
  }
  return s.replace(/;\s*$/, '').trim();
}

/** A value as the page shows it: dates as ISO text, binaries as hex, LOBs read as text. */
function cell(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    // Oracle DATE and TIMESTAMP come as the wall-clock time read in this PC's time zone: shown as they are stored.
    if (isNaN(v.getTime())) return String(v);
    const p = (n, w) => String(n).padStart(w || 2, '0');
    const ms = v.getMilliseconds();
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}` + (ms ? '.' + p(ms, 3) : '');
  }
  if (Buffer.isBuffer(v)) return v.length > 2000 ? `(binary, ${v.length} bytes)` : v.toString('hex').toUpperCase();
  if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return String(v); } }
  return v;
}

function friendly(e) {
  const m = String((e && e.message) || e || 'Unknown error');
  if (/NJS-503|ECONNREFUSED/.test(m)) return m + ' (nothing answers at that host and port: check the hostname, the port and the VPN)';
  if (/NJS-510|ETIMEDOUT|timed out/i.test(m)) return m + ' (no answer in time: check the hostname, the VPN or a firewall)';
  if (/ORA-01017/.test(m)) return m + ' (wrong username or password)';
  if (/ORA-12514|NJS-518/.test(m)) return m + ' (the listener does not know that service name)';
  if (/ORA-12505/.test(m)) return m + ' (the listener does not know that SID)';
  if (/ENOTFOUND|getaddrinfo/.test(m)) return m + ' (the hostname cannot be found)';
  return m;
}

async function open(opts) {
  const o = opts || {};
  const file = o.file;
  const now = o.now || (() => Date.now());
  let driver = o.driver || null;
  let driverError = '';
  const memoryPasswords = {}; // id → { password, walletPassword } when they cannot be encrypted, or were not to be saved
  const sessions = new Map();

  function getDriver() {
    if (driver) return driver;
    try {
      driver = require('oracledb');
      return driver;
    } catch (e) {
      driverError = 'The Oracle driver is not installed: run "npm install" in the project, then restart the app.';
      throw new Error(driverError);
    }
  }

  function read() {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { connections: [] }; }
  }
  function write(data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 1), { mode: 0o600 });
  }
  function seal(text) {
    if (!text) return null;
    if (!o.encrypt) return null;
    try { return o.encrypt(text).toString('base64'); } catch (e) { return null; }
  }
  function unseal(b64) {
    if (!b64 || !o.decrypt) return '';
    try { return o.decrypt(Buffer.from(b64, 'base64')); } catch (e) { return ''; }
  }
  function publicOf(c) {
    const spec = (() => { try { return connectSpec(c); } catch (e) { return { text: '' }; } })();
    const mem = memoryPasswords[c.id] || {};
    return {
      id: c.id, name: c.name, color: c.color || '', username: c.username, role: c.role || 'default', type: c.type || 'basic',
      host: c.host || '', port: c.port || '', sidType: c.sidType || 'service', service: c.service || '', sid: c.sid || '',
      tnsAdmin: c.tnsAdmin || '', tnsAlias: c.tnsAlias || '', connectString: c.connectString || '', walletLocation: c.walletLocation || '',
      readOnly: !!c.readOnly, savePassword: !!c.savePassword, hasPassword: !!(c.password || mem.password), details: (c.username || '') + '@' + spec.text,
      updatedAt: c.updatedAt || null
    };
  }
  function find(id) { return read().connections.filter((c) => c.id === id)[0] || null; }

  /** The full connection for connecting: the saved one with its password, overridden by what the dialog sends. */
  function resolve(input) {
    const x = input || {};
    const saved = x.id ? find(x.id) : null;
    const c = Object.assign({}, saved || {}, x);
    const mem = (x.id && memoryPasswords[x.id]) || {};
    c.password = trim(x.password) ? x.password : (saved && saved.password ? unseal(saved.password) : mem.password || '');
    c.walletPassword = trim(x.walletPassword) ? x.walletPassword : (saved && saved.walletPassword ? unseal(saved.walletPassword) : mem.walletPassword || '');
    return c;
  }

  async function connectRaw(c) {
    if (!trim(c.username)) throw new Error('Give the username.');
    if (!c.password) throw new Error('Give the password.');
    const spec = connectSpec(c);
    const d = getDriver();
    const params = { user: trim(c.username), password: c.password, connectString: spec.connectString, connectTimeout: CONNECT_TIMEOUT_S };
    if (spec.configDir) params.configDir = spec.configDir;
    if (trim(c.walletLocation)) { params.walletLocation = trim(c.walletLocation); if (c.walletPassword) params.walletPassword = c.walletPassword; }
    if (c.role === 'SYSDBA' && d.SYSDBA != null) params.privilege = d.SYSDBA;
    if (c.role === 'SYSOPER' && d.SYSOPER != null) params.privilege = d.SYSOPER;
    const conn = await d.getConnection(params);
    return { conn, spec };
  }

  async function banner(conn) {
    try {
      const r = await conn.execute('select banner from v$version where rownum = 1', [], { outFormat: 4001 });
      const row = r.rows && r.rows[0];
      return row ? String(Array.isArray(row) ? row[0] : (row.BANNER || Object.values(row)[0])) : '';
    } catch (e) {
      try {
        const r = await conn.execute("select sys_context('USERENV','DB_NAME') from dual");
        return 'Oracle Database ' + (r.rows && r.rows[0] ? r.rows[0][0] : '');
      } catch (e2) { return 'Oracle Database'; }
    }
  }

  function sessionOf(id) {
    const s = sessions.get(String(id || ''));
    if (!s) throw new Error('Not connected (the session ended). Connect again.');
    s.lastUsed = now();
    return s;
  }
  async function closeRs(s) {
    if (s.rs) { const rs = s.rs; s.rs = null; s.rsMeta = null; try { await rs.close(); } catch (e) { /* closed already */ } }
  }
  async function endSession(s, how) {
    sessions.delete(s.id);
    await closeRs(s);
    try { if (how !== 'commit') await s.conn.rollback(); } catch (e) { /* the connection may be gone */ }
    try { await s.conn.close(); } catch (e) { /* the connection may be gone */ }
  }
  const sweeper = setInterval(() => {
    const t = now();
    sessions.forEach((s) => { if (t - s.lastUsed > IDLE_MS) endSession(s, 'idle').catch(() => {}); });
  }, 60 * 1000);
  if (sweeper.unref) sweeper.unref();

  async function rowsFrom(s, n) {
    const rows = await s.rs.getRows(n);
    const more = rows.length === n;
    if (!more) await closeRs(s);
    return { rows: rows.map((r) => r.map(cell)), more };
  }

  async function dbmsOutput(conn) {
    const d = getDriver();
    const lines = [];
    try {
      for (let i = 0; i < 2000; i++) {
        const r = await conn.execute('begin dbms_output.get_line(:ln, :st); end;', {
          ln: { dir: d.BIND_OUT, type: d.STRING, maxSize: 32767 }, st: { dir: d.BIND_OUT, type: d.NUMBER } });
        if (r.outBinds.st !== 0) break;
        lines.push(r.outBinds.ln == null ? '' : String(r.outBinds.ln));
      }
    } catch (e) { /* no DBMS_OUTPUT */ }
    return lines;
  }

  const store = {
    info() {
      let version = '';
      try { version = getDriver().versionString || ''; } catch (e) { /* not installed */ }
      return { engine: driverError ? '' : 'oracledb', version, thin: driver ? driver.thin !== false : true, tnsAdmin: process.env.TNS_ADMIN || '',
        keychain: !!o.encrypt, error: driverError };
    },
    list() {
      return read().connections.map(publicOf).sort((a, b) => a.name.localeCompare(b.name));
    },
    save(input) {
      const x = input || {};
      const name = trim(x.name);
      if (!name) throw new Error('Give the connection a name.');
      connectSpec(x); // the details must make a connect string
      if (!trim(x.username)) throw new Error('Give the username.');
      const data = read();
      const clash = data.connections.filter((c) => c.name.toLowerCase() === name.toLowerCase() && c.id !== x.id)[0];
      if (clash) throw new Error(`A connection called "${clash.name}" exists already.`);
      const old = x.id ? data.connections.filter((c) => c.id === x.id)[0] : null;
      const id = old ? old.id : crypto.randomBytes(6).toString('hex');
      const keep = (k) => (trim(x[k]) ? x[k] : (old && old[k] ? unseal(old[k]) : (memoryPasswords[id] || {})[k] || ''));
      const password = keep('password');
      const walletPassword = keep('walletPassword');
      const savePassword = x.savePassword !== false;
      const sealed = savePassword ? seal(password) : null;
      const sealedWallet = savePassword ? seal(walletPassword) : null;
      const rec = {
        id, name, color: trim(x.color), username: trim(x.username), role: ['SYSDBA', 'SYSOPER'].indexOf(x.role) !== -1 ? x.role : 'default',
        type: ['basic', 'tns', 'custom'].indexOf(x.type) !== -1 ? x.type : 'basic', host: trim(x.host), port: trim(x.port) || '1521',
        sidType: x.sidType === 'sid' ? 'sid' : 'service', service: trim(x.service), sid: trim(x.sid), tnsAdmin: trim(x.tnsAdmin), tnsAlias: trim(x.tnsAlias),
        connectString: trim(x.connectString), walletLocation: trim(x.walletLocation), readOnly: !!x.readOnly, savePassword,
        password: sealed, walletPassword: sealedWallet, updatedAt: new Date(now()).toISOString()
      };
      // A password that cannot go to disk (no keychain, or "Save password" off) is kept for this run only.
      memoryPasswords[id] = { password: sealed ? '' : password, walletPassword: sealedWallet ? '' : walletPassword };
      data.connections = data.connections.filter((c) => c.id !== id).concat([rec]);
      write(data);
      return { id, saved: publicOf(rec), passwordKept: sealed ? 'keychain' : password ? (savePassword ? 'this run (no keychain on this PC)' : 'this run') : 'none' };
    },
    remove(id) {
      const data = read();
      data.connections = data.connections.filter((c) => c.id !== id);
      delete memoryPasswords[id];
      write(data);
      return { removed: id };
    },
    tnsAliases(dir) {
      const d = trim(dir) || process.env.TNS_ADMIN || '';
      if (!d) return { dir: '', file: '', aliases: [], note: 'Give the folder that holds tnsnames.ora (TNS_ADMIN is not set on this PC).' };
      const f = path.join(d, 'tnsnames.ora');
      try { return { dir: d, file: f, aliases: parseTns(fs.readFileSync(f, 'utf8')) }; } catch (e) { return { dir: d, file: f, aliases: [], note: `No tnsnames.ora in ${d}.` }; }
    },
    async test(input) {
      const t0 = now();
      let conn = null;
      try {
        const c = resolve(input);
        const r = await connectRaw(c);
        conn = r.conn;
        const b = await banner(conn);
        return { ok: true, ms: now() - t0, banner: b, user: trim(c.username).toUpperCase(), target: r.spec.text };
      } catch (e) {
        return { ok: false, ms: now() - t0, error: friendly(e) };
      } finally {
        if (conn) { try { await conn.close(); } catch (e) { /* closed */ } }
      }
    },
    async connect(input) {
      const c = resolve(input);
      const r = await connectRaw(c).catch((e) => { throw new Error(friendly(e)); });
      const id = crypto.randomBytes(12).toString('hex');
      const b = await banner(r.conn);
      try { await r.conn.execute('begin dbms_output.enable(null); end;'); } catch (e) { /* no DBMS_OUTPUT */ }
      const s = { id, conn: r.conn, connId: c.id || '', name: trim(c.name) || r.spec.text, user: trim(c.username).toUpperCase(), target: r.spec.text,
        readOnly: !!c.readOnly, banner: b, startedAt: now(), lastUsed: now(), pending: false, rs: null };
      sessions.set(id, s);
      return { session: id, name: s.name, user: s.user, target: s.target, banner: b, readOnly: s.readOnly };
    },
    async run(sessionId, sql, opts) {
      const s = sessionOf(sessionId);
      const kind = kindOf(sql);
      const text = clean(sql, kind);
      if (!text) throw new Error('Nothing to run.');
      if (s.readOnly && kind !== 'query' && !/^\s*EXPLAIN\b/i.test(text)) {
        throw new Error('This connection is read only: only queries run (SELECT or WITH). Edit the connection to allow changes.');
      }
      const d = getDriver();
      const n = Math.min(Math.max(Number((opts && opts.fetch) || FETCH), 1), MAX_FETCH);
      await closeRs(s);
      const t0 = now();
      if (kind === 'tx') {
        if (/^\s*COMMIT/i.test(text)) await s.conn.commit(); else await s.conn.rollback();
        s.pending = false;
        return { kind, ms: now() - t0, message: /^\s*COMMIT/i.test(text) ? 'Commit complete.' : 'Rollback complete.', pending: false };
      }
      try {
        if (kind === 'query') {
          const r = await s.conn.execute(text, [], { resultSet: true, outFormat: d.OUT_FORMAT_ARRAY || 4001,
            fetchTypeHandler: (meta) => (meta.dbType === d.DB_TYPE_CLOB || meta.dbType === d.DB_TYPE_NCLOB || meta.dbType === d.DB_TYPE_JSON ? { type: d.STRING } : undefined) });
          s.rs = r.resultSet;
          const columns = (r.metaData || []).map((m) => ({ name: m.name, type: (m.dbTypeName || '').toUpperCase(), nullable: m.nullable !== false }));
          s.rsMeta = columns;
          const page = await rowsFrom(s, n);
          return { kind, columns, rows: page.rows, more: page.more, fetched: page.rows.length, ms: now() - t0, pending: s.pending };
        }
        const r = await s.conn.execute(text, [], { autoCommit: false });
        if (kind === 'dml') s.pending = true;
        if (kind === 'ddl') s.pending = false; // Oracle commits before and after DDL
        const output = kind === 'plsql' ? await dbmsOutput(s.conn) : [];
        if (kind === 'plsql') s.pending = true; // a block may have changed data: commit or roll back to be sure
        const rowsAffected = r.rowsAffected != null ? r.rowsAffected : null;
        return { kind, rowsAffected, ms: now() - t0, output, pending: s.pending,
          message: kind === 'dml' ? `${rowsAffected} row${rowsAffected === 1 ? '' : 's'} ${/^\s*INSERT/i.test(text) ? 'inserted' : /^\s*DELETE/i.test(text) ? 'deleted' : /^\s*MERGE/i.test(text) ? 'merged' : 'updated'}.`
            : kind === 'ddl' ? 'Done (DDL commits by itself).' : kind === 'plsql' ? 'PL/SQL procedure successfully completed.' : 'Done.' };
      } catch (e) {
        const err = new Error(friendly(e));
        err.ms = now() - t0;
        throw err;
      }
    },
    async more(sessionId, count) {
      const s = sessionOf(sessionId);
      if (!s.rs) return { rows: [], more: false };
      const n = Math.min(Math.max(Number(count || FETCH), 1), MAX_FETCH);
      return rowsFrom(s, n);
    },
    async commit(sessionId) { const s = sessionOf(sessionId); await s.conn.commit(); s.pending = false; return { message: 'Commit complete.', pending: false }; },
    async rollback(sessionId) { const s = sessionOf(sessionId); await s.conn.rollback(); s.pending = false; return { message: 'Rollback complete.', pending: false }; },
    async cancel(sessionId) { const s = sessionOf(sessionId); try { await s.conn.breakExecution(); } catch (e) { /* nothing running */ } return { message: 'Cancel requested.' }; },
    async disconnect(sessionId) {
      const s = sessions.get(String(sessionId || ''));
      if (!s) return { message: 'Disconnected.' };
      const had = s.pending;
      await endSession(s, 'disconnect');
      return { message: had ? 'Disconnected: the uncommitted changes were rolled back.' : 'Disconnected.' };
    },
    sessions() {
      return Array.from(sessions.values()).map((s) => ({ session: s.id, name: s.name, user: s.user, target: s.target, pending: s.pending, readOnly: s.readOnly }));
    },
    async close() {
      clearInterval(sweeper);
      await Promise.all(Array.from(sessions.values()).map((s) => endSession(s, 'close').catch(() => {})));
    }
  };
  return store;
}

module.exports = { open, connectSpec, parseTns, kindOf, clean, cell, friendly, FETCH, MAX_FETCH };
