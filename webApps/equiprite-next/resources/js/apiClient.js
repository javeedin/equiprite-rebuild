define([], function () {
  'use strict';

  // The API tester (Application pages → a page → Integrations → Test; desktop/lib/apiTest.js does the work): what a
  // call sends, sending it (through the local server's proxy, to the real backend), Check all, the last runs, the
  // page's reports. The local server only (/__api/*, X-EquipRite-Api): the desktop app or npm run serve. Each call
  // resolves { ok, status, body } and never throws.
  function call(path, method, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    var opts = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-EquipRite-Api': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch('/__api/' + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = { error: r.ok ? 'An answer that is not JSON.' : 'HTTP ' + r.status }; }
        return { ok: r.ok && !!b && b.ok !== false, status: r.status, body: b || {} };
      });
    }, function (e) { return { ok: false, status: 0, body: { error: 'The local server did not answer: ' + ((e && e.message) || e) } }; });
  }
  var enc = encodeURIComponent;
  return {
    op: function (endpoint) { return call('op?endpoint=' + enc(endpoint || '')); },
    report: function (r) { return call('op?report=' + enc(r.path || '') + '&name=' + enc(r.name || '') + '&params=' + enc((r.params || []).join(',')) + '&rowTag=' + enc(r.rowTag || '')); },
    run: function (b) { return call('run', 'POST', b || {}); },
    check: function (endpoints) { return call('check', 'POST', { endpoints: endpoints || [] }); },
    last: function (keys) { return call('last', 'POST', { keys: keys || [] }); },
    reports: function (page, names) { return call('reports?page=' + enc(page || '') + '&names=' + enc((names || []).join(','))); }
  };
});
