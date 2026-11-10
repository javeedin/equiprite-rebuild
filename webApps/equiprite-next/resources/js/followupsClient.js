define([], function () {
  'use strict';

  // The Follow-ups page's line to the desktop app, which keeps saved follow-ups in DuckDB on this PC
  // (desktop/lib/followups.js, served at /__followups/* to this PC only, behind X-EquipRite-Followups). In VBCS (no
  // desktop app) info() says Follow-ups is not available here. Each call resolves { ok, status, body } and never throws.

  var BASE = '/__followups/';

  function call(path, method, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    var opts = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-EquipRite-Followups': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch(BASE + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = { error: r.ok ? 'An answer that is not JSON.' : 'HTTP ' + r.status }; }
        return { ok: r.ok && !(b && b.error), status: r.status, body: b || {} };
      });
    }, function (e) {
      return { ok: false, status: 0, body: { error: 'The desktop app did not answer: ' + ((e && e.message) || e) } };
    });
  }

  /** Whether Follow-ups runs here (only the desktop app answers /__followups/*). */
  function info() {
    return call('list').then(function (r) {
      if (r.status !== 200 || !r.body || (r.body.ok === false && /not set up|not available/i.test(r.body.error || ''))) {
        return { available: false, error: 'Saved follow-ups are kept on this PC by the EquipRite desktop app. This page is not available in the browser (VBCS).' };
      }
      return { available: true };
    });
  }

  return {
    info: info,
    list: function () { return call('list'); },
    get: function (id) { return call('get?id=' + encodeURIComponent(id || '')); },
    save: function (f) { return call('save', 'POST', f || {}); },
    remove: function (id) { return call('remove', 'POST', { id: id }); },
  };
});
