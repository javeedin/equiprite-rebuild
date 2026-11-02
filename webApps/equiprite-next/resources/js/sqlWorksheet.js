define([], function () {
  'use strict';

  // The SQL worksheet's own logic, without the page: splitting a script into statements as SQL Developer does, the
  // statement at the cursor, what a statement is, the result grid, the connection form (SQL Developer's New / Select
  // Database Connection) and the history. The page sends the statements to the desktop app (resources/js/sqlClient.js
  // → desktop/lib/oracleSql.js), which runs them against Oracle.

  var KINDS = { query: 'Query', dml: 'Change (DML)', ddl: 'Definition (DDL)', plsql: 'PL/SQL', tx: 'Transaction', other: 'Statement' };

  function firstWords(text) {
    return String(text || '').replace(/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/|\s)+/, '').toUpperCase();
  }

  /** What a statement is, from its first words: query, dml, ddl, plsql, tx (commit / rollback) or other. */
  function kindOf(sql) {
    var s = firstWords(sql);
    var w = (s.match(/^[A-Z]+/) || [''])[0];
    if (w === 'SELECT' || w === 'WITH' || w === 'VALUES') return 'query';
    if (['INSERT', 'UPDATE', 'DELETE', 'MERGE'].indexOf(w) !== -1) return 'dml';
    if (w === 'BEGIN' || w === 'DECLARE' || w === 'CALL' || w === 'EXEC' || w === 'EXECUTE') return 'plsql';
    if (w === 'CREATE' && /^CREATE\s+(OR\s+REPLACE\s+)?(EDITIONABLE\s+|NONEDITIONABLE\s+)?(PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE|LIBRARY|JAVA)\b/.test(s)) return 'plsql';
    if (w === 'COMMIT' || w === 'ROLLBACK') return 'tx';
    if (['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME', 'GRANT', 'REVOKE', 'COMMENT', 'PURGE', 'FLASHBACK', 'ANALYZE', 'AUDIT', 'NOAUDIT'].indexOf(w) !== -1) return 'ddl';
    return 'other';
  }
  /** A block of PL/SQL ends at a line holding only "/", not at its first ";". */
  function isBlock(sql) {
    var s = firstWords(sql);
    return /^(BEGIN|DECLARE)\b/.test(s) || /^CREATE\s+(OR\s+REPLACE\s+)?(EDITIONABLE\s+|NONEDITIONABLE\s+)?(PROCEDURE|FUNCTION|PACKAGE|TRIGGER|TYPE)\b/.test(s);
  }
  function onlyComments(text) { return !String(text || '').replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim(); }

  /**
   * The statements of a script, in order: { text, start, end, line }. A statement ends at a ";" outside quotes and
   * comments, a PL/SQL block at a line holding only "/" (as in SQL Developer and SQL*Plus); `end` includes the
   * terminator. Quotes: '…' ('' inside), q'[…]' and the other q-quote pairs, "…". Comments: -- and /* … *\/.
   */
  function split(script) {
    var src = String(script || '');
    var out = [];
    var start = 0;
    var i = 0;
    var n = src.length;
    function push(endExcl, endIncl) {
      var raw = src.slice(start, endExcl);
      var lead = raw.length - raw.replace(/^\s+/, '').length;
      var text = raw.trim();
      if (text && !onlyComments(text)) out.push({ text: text, start: start + lead, end: endIncl, line: src.slice(0, start + lead).split('\n').length });
      start = endIncl;
    }
    while (i < n) {
      var ch = src[i];
      var nx = src[i + 1];
      // A line holding only "/" ends whatever is open.
      if (ch === '/' && (i === 0 || src[i - 1] === '\n' || /^[ \t]*$/.test(src.slice(src.lastIndexOf('\n', i - 1) + 1, i))) && /^[ \t]*(\r?\n|$)/.test(src.slice(i + 1))) {
        push(i, i + 1);
        i += 1;
        continue;
      }
      if (ch === '-' && nx === '-') { var eol = src.indexOf('\n', i); i = eol === -1 ? n : eol + 1; continue; }
      if (ch === '/' && nx === '*') { var ec = src.indexOf('*/', i + 2); i = ec === -1 ? n : ec + 2; continue; }
      if ((ch === 'q' || ch === 'Q') && nx === "'" && i + 2 < n && !/[A-Za-z0-9_$#]/.test(src[i - 1] || '')) {
        var open = src[i + 2];
        var close = { '[': ']', '{': '}', '(': ')', '<': '>' }[open] || open;
        var eq = src.indexOf(close + "'", i + 3);
        i = eq === -1 ? n : eq + 2;
        continue;
      }
      if (ch === "'") {
        var j = i + 1;
        while (j < n) { if (src[j] === "'") { if (src[j + 1] === "'") { j += 2; continue; } break; } j++; }
        i = j + 1;
        continue;
      }
      if (ch === '"') { var dq = src.indexOf('"', i + 1); i = dq === -1 ? n : dq + 1; continue; }
      if (ch === ';' && !isBlock(src.slice(start, i))) { push(i, i + 1); i += 1; continue; }
      i += 1;
    }
    push(n, n);
    return out;
  }

  /** The statement under the cursor (SQL Developer's Run Statement): the one around it, else the one just before. */
  function atCursor(script, pos) {
    var list = split(script);
    if (!list.length) return null;
    var p = Number(pos) || 0;
    var hit = list.filter(function (s) { return p >= s.start && p <= s.end; })[0];
    if (hit) return hit;
    var before = list.filter(function (s) { return s.end <= p; });
    return before.length ? before[before.length - 1] : list[0];
  }

  /** A value as a cell shows it: (null), numbers to the right, long text cut with the whole of it on hover. */
  function cellOf(v, col) {
    if (v === null || v === undefined) return { t: '(null)', full: '', cls: 'nx-sql-null' };
    var num = typeof v === 'number';
    var s = String(v);
    return { t: s.length > 200 ? s.slice(0, 200) + '…' : s, full: s.length > 200 ? s : '', cls: num ? 'nx-sql-num' : (col && /DATE|TIMESTAMP/.test(col.type) ? 'nx-sql-date' : '') };
  }

  /** The result grid: its header and rows (with row numbers), and the grid's column template. */
  function grid(columns, rows, from) {
    var cols = (columns || []).map(function (c) { return { name: c.name, type: c.type || '', title: c.name + (c.type ? ' · ' + c.type : '') }; });
    var base = Number(from) || 0;
    return {
      columns: cols,
      rows: (rows || []).map(function (r, i) {
        return { n: base + i + 1, key: String(base + i), cells: (r || []).map(function (v, k) { var c = cellOf(v, cols[k]); c.key = String(k); return c; }) };
      }),
      style: { gridTemplateColumns: '52px ' + (cols.length ? cols.map(function (c) { return /NUMBER|FLOAT|INTEGER|BINARY_/.test(c.type) ? 'minmax(72px, 200px)' : 'minmax(96px, 320px)'; }).join(' ') : '1fr') }
    };
  }

  /** The result as exportKit takes it. */
  function exportSpec(columns, rows) {
    var cols = (columns || []).map(function (c, k) { return { key: 'c' + k, label: c.name, type: /NUMBER|FLOAT|INTEGER|BINARY_/.test(c.type || '') ? 'number' : 'text' }; });
    return { columns: cols, rows: (rows || []).map(function (r) { var o = {}; (r || []).forEach(function (v, k) { o['c' + k] = v; }); return o; }) };
  }

  // ── The connection form (SQL Developer's New / Select Database Connection) ─────────────────────────────────────
  var COLORS = ['', '#2e7d4f', '#1f6fb2', '#b45309', '#b42318', '#6d28d9'];

  function blankForm() {
    return { id: '', name: '', color: '', username: '', password: '', savePassword: true, role: 'default', type: 'basic', host: '', port: '1521',
      sidType: 'service', service: '', sid: '', tnsAdmin: '', tnsAlias: '', connectString: '', walletLocation: '', walletPassword: '', readOnly: false, hasPassword: false };
  }
  /** A saved connection into the form (its password is never sent back: hasPassword says one is kept). */
  function formOf(c) {
    var f = blankForm();
    Object.keys(f).forEach(function (k) { if (c && c[k] !== undefined && c[k] !== null) f[k] = c[k]; });
    f.password = '';
    f.walletPassword = '';
    f.port = String(f.port || '1521');
    return f;
  }
  /** The details shown in the list: user@host:port/service, user@host:port:SID, user@alias or the connect string. */
  function details(f) {
    var u = f.username || '?';
    if (f.type === 'tns') return u + '@' + (f.tnsAlias || '(alias)');
    if (f.type === 'custom') return u + '@' + (String(f.connectString || '(connect identifier)').replace(/\s+/g, ' ').slice(0, 60));
    return u + '@' + (f.host || '(host)') + ':' + (f.port || '1521') + (f.sidType === 'sid' ? ':' + (f.sid || '(SID)') : '/' + (f.service || '(service)'));
  }
  /**
   * A name for a connection connected without one (Connect saves it, as SQL Developer does): user@service, user@SID,
   * user@alias or user@host; " (2)", " (3)"… when another connection has that name already.
   */
  function autoName(f, taken) {
    var u = String(f.username || 'user').trim();
    var where = f.type === 'tns' ? f.tnsAlias : f.type === 'custom' ? String(f.connectString || '').split(/[/(\s]/).filter(Boolean)[0] || 'database'
      : (f.sidType === 'sid' ? f.sid : f.service) || f.host;
    var base = u + '@' + String(where || 'database').trim();
    var names = (taken || []).map(function (n) { return String(n).toLowerCase(); });
    var name = base;
    for (var i = 2; names.indexOf(name.toLowerCase()) !== -1 && i < 100; i++) name = base + ' (' + i + ')';
    return name;
  }

  /** What is missing before Test or Connect, in words ('' when the form is complete). */
  function missing(f, forSave) {
    var m = [];
    if (forSave && !String(f.name || '').trim()) m.push('a name');
    if (!String(f.username || '').trim()) m.push('the username');
    if (!forSave && !f.password && !f.hasPassword) m.push('the password');
    if (f.type === 'tns') { if (!String(f.tnsAlias || '').trim()) m.push('the network alias'); }
    else if (f.type === 'custom') { if (!String(f.connectString || '').trim()) m.push('the connect identifier'); }
    else {
      if (!String(f.host || '').trim()) m.push('the hostname');
      var p = Number(f.port);
      if (!(p > 0 && p < 65536)) m.push('a port from 1 to 65535');
      if (f.sidType === 'sid' ? !String(f.sid || '').trim() : !String(f.service || '').trim()) m.push(f.sidType === 'sid' ? 'the SID' : 'the service name');
    }
    return m.length ? 'Give ' + (m.length === 1 ? m[0] : m.slice(0, -1).join(', ') + ' and ' + m[m.length - 1]) + '.' : '';
  }
  /** One field changed: the new form (a port keeps digits only). */
  function setField(f, key, value) {
    var o = Object.assign({}, f);
    if (key === 'savePassword' || key === 'readOnly') o[key] = value === true || value === 'true' || value === 'on';
    else if (key === 'port') o.port = String(value || '').replace(/[^0-9]/g, '').slice(0, 5);
    else o[key] = value == null ? '' : String(value);
    return o;
  }

  /**
   * The dialog's inputs set to the form, after a chain changed the form (New, Clear, picking a connection, Save): a
   * native input the person typed in keeps its own value otherwise. Run after the dialog has drawn.
   */
  function fillInputs(form, doc, root) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return 0;
    var n = 0;
    Array.prototype.forEach.call(d.querySelectorAll((root || '#sqlDialog') + ' [data-field]'), function (el) {
      var k = el.getAttribute('data-field');
      if (!Object.prototype.hasOwnProperty.call(form || {}, k)) return;
      if (el.type === 'checkbox') el.checked = !!form[k];
      else if (el.type === 'radio') el.checked = el.value === form[k];
      else if (el.tagName === 'BUTTON') return;
      else el.value = form[k] == null ? '' : String(form[k]);
      n += 1;
    });
    return n;
  }

  // ── Ask AI ───────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * The SQL an LLM wrote, put at the end of the worksheet under a comment naming who wrote it and for what; returns the
   * new text and where the statement sits, so it is selected (Ctrl+Enter runs the selection) and never run by itself.
   */
  function aiInsert(text, sql, question, who) {
    var body = String(sql || '').trim();
    if (body && !/;\s*$/.test(body) && !/\n\/\s*$/.test(body)) body += ';';
    var head = '-- Ask AI (' + (who || 'LLM') + '): ' + String(question || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    var before = String(text || '').replace(/\s+$/, '');
    var lead = before ? before + '\n\n' : '';
    var out = lead + head + '\n' + body + '\n';
    var start = (lead + head + '\n').length;
    return { text: out, start: start, end: start + body.length };
  }
  /** "Claude (Anthropic) · <model>", or what is still to choose. */
  function aiWho(settings) {
    var st = settings || {};
    var id = st.active;
    var cat = (st.catalog || []).filter(function (p) { return p.id === id; })[0];
    var pr = (st.providers || {})[id] || {};
    if (!cat) return '';
    return cat.label + (pr.model ? ' · ' + pr.model : ' · no model yet');
  }

  // ── History: the last statements run on this PC ────────────────────────────────────────────────────────────────
  var HISTORY_MAX = 100;
  function remember(list, item) {
    var l = (list || []).filter(function (h) { return h.sql !== item.sql || h.conn !== item.conn; });
    l.unshift(item);
    return l.slice(0, HISTORY_MAX);
  }
  function historyRows(list) {
    return (list || []).map(function (h, i) {
      return { i: i, key: String(i) + ':' + h.at, at: h.at, when: String(h.at || '').replace('T', ' ').slice(0, 16), conn: h.conn || '', sql: h.sql,
        short: String(h.sql || '').replace(/\s+/g, ' ').slice(0, 140), kind: KINDS[h.kind] || 'Statement', ok: h.ok !== false, outcome: h.outcome || '', ms: h.ms };
    });
  }

  /** How long a run took, in words: "0.21 s", "1.4 s", "2 min 05 s". */
  function took(ms) {
    var m = Number(ms) || 0;
    if (m < 1000) return (m / 1000).toFixed(2) + ' s';
    if (m < 60000) return (m / 1000).toFixed(1) + ' s';
    var s = Math.round(m / 1000);
    return Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s';
  }

  return { KINDS: KINDS, COLORS: COLORS, kindOf: kindOf, isBlock: isBlock, split: split, atCursor: atCursor, cellOf: cellOf, grid: grid, exportSpec: exportSpec,
    blankForm: blankForm, formOf: formOf, details: details, missing: missing, setField: setField, fillInputs: fillInputs, autoName: autoName, aiInsert: aiInsert, aiWho: aiWho, remember: remember, historyRows: historyRows, took: took };
});
