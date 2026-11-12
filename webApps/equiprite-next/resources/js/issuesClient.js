define([], function () {
  'use strict';

  // Issues (Build.Rite's Issues screen; desktop/lib/issues.js does the work): log, write up, analyze, approve, apply,
  // close. The local server only (/__issues/*, X-EquipRite-Issues): the desktop app. Each call resolves
  // { ok, status, body } and never throws.
  function call(path, method, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    var opts = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-EquipRite-Issues': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch('/__issues/' + path, opts).then(function (r) {
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
    list: function (q, status) { return call('list?q=' + encodeURIComponent(q || '') + '&status=' + encodeURIComponent(status || '')); },
    get: function (id) { return call('get?id=' + encodeURIComponent(id || '')); },
    imgUrl: function (issue, n) { return issue ? '/__issues/img?id=' + encodeURIComponent(issue.id) + '&n=' + n : ''; },
    create: function (b) { return post('create', b); },
    format: function (id) { return post('format', { id: id }); },
    update: function (id, fields) { return post('update', { id: id, fields: fields }); },
    toJira: function (id) { return post('jira', { id: id }); },
    analyze: function (id, refine) { return post('analyze', { id: id, refine: refine || '' }); },
    ask: function (id, email) { return post('ask', { id: id, email: !!email }); },
    approve: function (id) { return post('approve', { id: id }); },
    reject: function (id, reason) { return post('reject', { id: id, reason: reason || '' }); },
    apply: function (id) { return post('apply', { id: id }); },
    close: function (id, note) { return post('close', { id: id, note: note || '' }); },
    reopen: function (id) { return post('reopen', { id: id }); }
  };
});
