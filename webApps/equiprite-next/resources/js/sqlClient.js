define([], function () {
  'use strict';

  // The SQL worksheet's line to the desktop app, which connects to Oracle for it (desktop/lib/oracleSql.js, served at
  // /__sql/* to this PC only). Every call carries X-EquipRite-SQL: the desktop app answers only calls that do, which a
  // page of another site cannot make. In VBCS (no desktop app) info() says the worksheet is not available here.
  //
  // Each call resolves { ok, status, body } and never throws; body.error carries the database's message.

  var BASE = '/__sql/';

  function call(path, method, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    var opts = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-EquipRite-SQL': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch(BASE + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = { error: r.ok ? 'An answer that is not JSON.' : 'HTTP ' + r.status }; }
        // The desktop app answers a database error as data ({ error }), so a refused statement is not a failed call.
        return { ok: r.ok && !(b && b.error), status: r.status, body: b || {} };
      });
    }, function (e) {
      return { ok: false, status: 0, body: { error: 'The desktop app did not answer: ' + ((e && e.message) || e) } };
    });
  }

  /** Whether the worksheet can run here: { available, engine, version, keychain, error }. */
  function info() {
    return call('info').then(function (r) {
      var b = r.body || {};
      // Only the desktop app answers 200 with an engine (or with why its driver is missing); VBCS and others do not.
      if (r.status !== 200 || !b || (b.engine !== 'oracledb' && !b.error)) {
        return { available: false, error: 'The SQL worksheet runs in the EquipRite desktop app, which connects to the database from this PC. It is not available in the browser (VBCS).' };
      }
      return { available: !b.error, engine: b.engine, version: b.version || '', keychain: !!b.keychain, tnsAdmin: b.tnsAdmin || '', error: b.error || '', file: b.file || '' };
    });
  }

  return {
    info: info,
    connections: function () { return call('connections'); },
    save: function (conn) { return call('connections', 'POST', conn); },
    remove: function (id) { return call('connections/' + encodeURIComponent(id), 'DELETE'); },
    tns: function (dir) { return call('tns?dir=' + encodeURIComponent(dir || '')); },
    test: function (conn) { return call('test', 'POST', conn); },
    connect: function (conn) { return call('connect', 'POST', conn); },
    sessions: function () { return call('sessions'); },
    run: function (session, sql, fetch) { return call('run', 'POST', { session: session, sql: sql, fetch: fetch }); },
    more: function (session, count) { return call('more', 'POST', { session: session, count: count }); },
    commit: function (session) { return call('commit', 'POST', { session: session }); },
    rollback: function (session) { return call('rollback', 'POST', { session: session }); },
    cancel: function (session) { return call('cancel', 'POST', { session: session }); },
    disconnect: function (session) { return call('disconnect', 'POST', { session: session }); },
    // Ask AI: the LLM chosen and its key stay in the desktop app; the page sends the question and gets SQL back.
    aiSettings: function () { return call('ai/settings'); },
    aiSave: function (form) { return call('ai/settings', 'POST', form); },
    aiForget: function (provider) { return call('ai/forget', 'POST', { provider: provider }); },
    aiModels: function (provider) { return call('ai/models', 'POST', { provider: provider }); },
    aiAsk: function (session, question, sql) { return call('ai/ask', 'POST', { session: session, question: question, sql: sql }); },
    // A plain chat turn (no SQL), for features that just need the LLM to rewrite or format text (e.g. Minutes "Format by AI").
    aiChat: function (system, user) { return call('ai/chat', 'POST', { system: system, user: user }); }
  };
});
