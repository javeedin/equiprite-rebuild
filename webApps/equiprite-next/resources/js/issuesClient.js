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
  /** A native <textarea> shows its text, not a bound value: each step's boxes filled from the page's variables once drawn
   *  (the write-up, the refine box, the verify and close notes, the discussion), never the one being typed in. */
  function fillBoxes(v) {
    var put = function () {
      try {
        var edit = v.edit || {};
        Array.prototype.forEach.call(document.querySelectorAll('#isWriteup textarea[data-field], #isWriteup input[data-field]'), function (el) {
          var k = el.getAttribute('data-field');
          if (Object.prototype.hasOwnProperty.call(edit, k) && document.activeElement !== el) el.value = edit[k];
        });
        [['isRefine', v.refine], ['isVNotes', v.vNotes], ['isRNotes', v.rNotes], ['isCText', v.cText]].forEach(function (p) {
          var el = document.getElementById(p[0]);
          if (el && document.activeElement !== el) el.value = p[1] || '';
        });
      } catch (e) { /* no DOM */ }
    };
    [0, 60, 250].forEach(function (ms) { setTimeout(put, ms); });
  }
  return {
    fillBoxes: fillBoxes,
    info: function () { return call('info'); },
    list: function (q, status) { return call('list?q=' + encodeURIComponent(q || '') + '&status=' + encodeURIComponent(status || '')); },
    get: function (id) { return call('get?id=' + encodeURIComponent(id || '')); },
    imgUrl: function (issue, n) { return issue ? '/__issues/img?id=' + encodeURIComponent(issue.id) + '&n=' + n : ''; },
    create: function (b) { return post('create', b); },
    format: function (id) { return post('format', { id: id }); },
    update: function (id, fields) { return post('update', { id: id, fields: fields }); },
    toJira: function (id) { return post('jira', { id: id }); },
    analyze: function (id, refine) { return post('analyze', { id: id, refine: refine || '' }); },
    ask: function (id, email, to) { return post('ask', { id: id, email: !!email, to: to || '' }); },
    approve: function (id) { return post('approve', { id: id }); },
    reject: function (id, reason) { return post('reject', { id: id, reason: reason || '' }); },
    apply: function (id) { return post('apply', { id: id }); },
    close: function (id, b) { return post('close', Object.assign({ id: id }, typeof b === 'string' ? { note: b } : (b || {}))); },
    verify: function (id, b) { return post('verify', Object.assign({ id: id }, b || {})); },
    details: function (id, fields) { return post('details', { id: id, fields: fields || {} }); },
    comment: function (id, b) { return post('comment', Object.assign({ id: id }, b || {})); },
    settings: function () { return call('settings'); },
    setProject: function (project) { return post('settings', { project: project || '' }); },
    reopen: function (id) { return post('reopen', { id: id }); }
  };
});
