define([], function () {
  'use strict';

  // Setup → Organizations & projects (Build.Rite; desktop/lib/vbs.js does the work): the VB Studio organizations, their
  // sign-in (kept encrypted on this PC, never sent back here) and their projects. The local server only (/__vbs/*,
  // X-EquipRite-Vbs): the desktop app. Each call resolves { ok, status, body } and never throws.
  function call(path, method, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    var opts = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-EquipRite-Vbs': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch('/__vbs/' + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = { error: r.ok ? 'An answer that is not JSON.' : 'HTTP ' + r.status }; }
        return { ok: r.ok && !!b && b.ok !== false, status: r.status, body: b || {} };
      });
    }, function (e) { return { ok: false, status: 0, body: { error: 'The local server did not answer: ' + ((e && e.message) || e) } }; });
  }
  var post = function (p, b) { return call(p, 'POST', b || {}); };
  return {
    state: function () { return call('state'); },
    saveOrg: function (b) { return post('org', b); },
    removeOrg: function (id) { return post('org/remove', { id: id }); },
    addProject: function (b) { return post('project', b); },
    checkProject: function (id) { return post('project/check', { id: id }); },
    removeProject: function (id) { return post('project/remove', { id: id }); },
  };
});
