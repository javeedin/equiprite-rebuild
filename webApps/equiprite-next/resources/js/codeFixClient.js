define([], function () {
  'use strict';

  // Code Fix, for the Code fix tab of Application pages (desktop/lib/codeFix.js does the work): the AI proposes a change
  // to a page; it is written to the code only when approved. The local server only (/__fix/*, X-EquipRite-Fix): the
  // desktop app. Each call resolves { ok, status, body } and never throws.

  function call(path, method, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    var opts = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-EquipRite-Fix': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch('/__fix/' + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = { error: r.ok ? 'An answer that is not JSON.' : 'HTTP ' + r.status }; }
        return { ok: r.ok && !!b && b.ok !== false && !b.error, status: r.status, body: b || {} };
      });
    }, function (e) { return { ok: false, status: 0, body: { error: 'The local server did not answer: ' + ((e && e.message) || e) } }; });
  }
  var post = function (p, b) { return call(p, 'POST', b || {}); };

  return {
    info: function () { return call('info'); },
    list: function (page) { return call('list?page=' + encodeURIComponent(page || '')); },
    get: function (id) { return call('get?id=' + encodeURIComponent(id || '')); },
    shotUrl: function (fix, which) { return fix && fix.preview ? '/__fix/shot?id=' + encodeURIComponent(fix.id) + '&which=' + which + '&t=' + encodeURIComponent(fix.preview.at || '') : ''; },
    pick: function () { return post('pick'); },
    analyze: function (b) { return post('analyze', b); },
    preview: function (fix) { return post('preview', { fix: fix }); },
    apply: function (fix, skipPull) { return post('apply', { fix: fix, skipPull: !!skipPull }); },
    test: function (fix) { return post('test', { fix: fix }); },
    e2e: function (fix) { return post('e2e', { fix: fix }); },
    undo: function (fix, force) { return post('undo', { fix: fix, force: !!force }); },
    commit: function (fix, push) { return post('commit', { fix: fix, push: !!push }); },
    discard: function (fix) { return post('discard', { fix: fix }); }
  };
});
