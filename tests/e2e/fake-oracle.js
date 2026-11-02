'use strict';
/*
 * A stand-in for the oracledb module (node-oracledb), for the SQL worksheet's tests: getConnection checks the password,
 * a connection answers the banner, an EMP table of 450 rows (a result set read in pages), UPDATE/INSERT/DELETE with
 * rows affected, DDL, a PL/SQL block with DBMS_OUTPUT lines, ORA-00942 for an unknown table, commit and rollback.
 * `calls` records what reached the "database" (statements and connects), for the tests to read.
 */
function fakeOracle(opts) {
  const o = opts || {};
  const password = o.password || 'secret';
  const calls = [];
  const EMP = Array.from({ length: 450 }, (_, i) => [7000 + i, 'EMP ' + (i + 1), i % 3 === 0 ? null : 1000 + i * 10, new Date(2026, 0, 1 + (i % 28), 9, 30, 0)]);
  const D = {
    versionString: '6.10.0', thin: true, OUT_FORMAT_ARRAY: 4001, BIND_OUT: 3003, STRING: 2001, NUMBER: 2010, SYSDBA: 2, SYSOPER: 4,
    DB_TYPE_CLOB: 'CLOB', DB_TYPE_NCLOB: 'NCLOB', DB_TYPE_JSON: 'JSON',
    calls,
    async getConnection(p) {
      calls.push({ op: 'connect', user: p.user, connectString: p.connectString, configDir: p.configDir || '', privilege: p.privilege || 0 });
      if (o.down) { const e = new Error('NJS-503: connection to host ' + p.connectString + ' could not be established.\nconnect ECONNREFUSED'); throw e; }
      if (p.password !== password) throw new Error('ORA-01017: invalid username/password; logon denied');
      let output = [];
      let pending = 0;
      const conn = {
        closed: false,
        async execute(sql, binds) {
          const s = String(sql).trim();
          calls.push({ op: 'execute', sql: s });
          if (/from v\$version/i.test(s)) return { rows: [['Oracle Database 19c Enterprise Edition Release 19.0.0.0.0 - Production']], metaData: [{ name: 'BANNER' }] };
          if (/dbms_output\.enable/i.test(s)) return {};
          if (/dbms_output\.get_line/i.test(s)) {
            const line = output.shift();
            return { outBinds: line === undefined ? { ln: null, st: 1 } : { ln: line, st: 0 } };
          }
          if (/^select user from dual$/i.test(s)) return { rows: [[String(p.user).toUpperCase()]] };
          if (/from user_tab_columns/i.test(s)) {
            return { rows: [['DEPT', 'DEPTNO', 'NUMBER', 'TABLE'], ['DEPT', 'DNAME', 'VARCHAR2', 'TABLE'], ['EMP', 'EMPNO', 'NUMBER', 'TABLE'], ['EMP', 'ENAME', 'VARCHAR2', 'TABLE'],
              ['EMP', 'SAL', 'NUMBER', 'TABLE'], ['EMP', 'HIREDATE', 'DATE', 'TABLE'], ['EMP', 'DEPTNO', 'NUMBER', 'TABLE'], ['BIN$abc', 'X', 'NUMBER', 'TABLE']] };
          }
          if (/^select\b.*\bfrom\s+nope\b/i.test(s)) throw new Error('ORA-00942: table or view does not exist');
          if (/^(select|with)\b.*\bfrom\s+emp\b/is.test(s)) {
            let at = 0;
            return {
              metaData: [{ name: 'EMPNO', dbTypeName: 'NUMBER' }, { name: 'ENAME', dbTypeName: 'VARCHAR2' }, { name: 'SAL', dbTypeName: 'NUMBER' }, { name: 'HIREDATE', dbTypeName: 'DATE' }],
              resultSet: { async getRows(n) { const r = EMP.slice(at, at + n); at += r.length; return r; }, async close() {} }
            };
          }
          if (/^select\b/i.test(s)) {
            return { metaData: [{ name: 'X', dbTypeName: 'NUMBER' }], resultSet: { done: false, async getRows() { if (this.done) return []; this.done = true; return [[1]]; }, async close() {} } };
          }
          if (/^update\s+emp\b/i.test(s)) { pending += 2; return { rowsAffected: 2 }; }
          if (/^insert\b/i.test(s)) { pending += 1; return { rowsAffected: 1 }; }
          if (/^delete\b/i.test(s)) { pending += 3; return { rowsAffected: 3 }; }
          if (/^begin\b/i.test(s)) { output = ['Hello from PL/SQL', 'Second line']; return {}; }
          if (/^(create|drop|alter|truncate)\b/i.test(s)) { pending = 0; return {}; }
          return {};
        },
        async commit() { calls.push({ op: 'commit', pending }); pending = 0; },
        async rollback() { calls.push({ op: 'rollback', pending }); pending = 0; },
        async breakExecution() { calls.push({ op: 'break' }); },
        async close() { this.closed = true; calls.push({ op: 'close' }); }
      };
      return conn;
    }
  };
  return D;
}

module.exports = { fakeOracle };
