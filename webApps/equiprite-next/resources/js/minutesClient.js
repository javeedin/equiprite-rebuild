define([], function () {
  'use strict';

  // The Minutes page's line to the desktop app, which keeps the meetings in DuckDB on this PC (desktop/lib/minutes.js,
  // served at /__minutes/* to this PC only, behind X-EquipRite-Minutes). Also the browser-side bits the page needs:
  // recording the microphone for voice→text, and copying / mailing / downloading the formatted minutes. In VBCS (no
  // desktop app) info() says Minutes is not available here. Each call resolves { ok, status, body } and never throws.

  var BASE = '/__minutes/';

  function call(base, header, path, method, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    var h = {}; h[header] = '1';
    var opts = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: h };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch(base + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = { error: r.ok ? 'An answer that is not JSON.' : 'HTTP ' + r.status }; }
        return { ok: r.ok && !(b && b.error === undefined ? false : b && b.error), status: r.status, body: b || {} };
      });
    }, function (e) {
      return { ok: false, status: 0, body: { error: 'The desktop app did not answer: ' + ((e && e.message) || e) } };
    });
  }
  function min(path, method, body) { return call(BASE, 'X-EquipRite-Minutes', path, method, body); }
  function sql(path, method, body) { return call('/__sql/', 'X-EquipRite-SQL', path, method, body); }

  /** Whether Minutes runs here (only the desktop app answers /__minutes/*). */
  function info() {
    return min('list').then(function (r) {
      if (r.status !== 200 || !r.body || (r.body.ok === false && /not set up|not available/i.test(r.body.error || ''))) {
        return { available: false, error: 'Standup minutes are kept on this PC by the EquipRite desktop app. This page is not available in the browser (VBCS).' };
      }
      return { available: true };
    });
  }

  // ── Recording the microphone (voice → text) ──────────────────────────────────────────────────────────────────────
  var rec = null, chunks = [], stream = null, mime = 'audio/webm';
  function recording() { return !!rec; }
  function startRec() {
    if (rec) return Promise.resolve(true);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      return Promise.reject(new Error('This device cannot record audio.'));
    }
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      stream = s; chunks = [];
      mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].filter(function (m) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m); })[0] || 'audio/webm';
      rec = new MediaRecorder(stream, { mimeType: mime });
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.start();
      return true;
    });
  }
  function stopRec() {
    return new Promise(function (resolve, reject) {
      if (!rec) { resolve(null); return; }
      var r = rec;
      r.onstop = function () {
        var blob = new Blob(chunks, { type: (mime || 'audio/webm').split(';')[0] });
        if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); }
        rec = null; stream = null;
        var fr = new FileReader();
        fr.onload = function () { resolve({ base64: String(fr.result).replace(/^data:[^,]*,/, ''), mime: blob.type || 'audio/webm' }); };
        fr.onerror = function () { reject(new Error('Could not read the recording.')); };
        fr.readAsDataURL(blob);
      };
      try { r.stop(); } catch (e) { rec = null; reject(e); }
    });
  }
  function cancelRec() { try { if (rec) rec.stop(); } catch (e) { /* stopping */ } if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); } rec = null; stream = null; chunks = []; }

  // ── Copy / mail / download (the formatted minutes) ───────────────────────────────────────────────────────────────
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    return Promise.resolve(false);
  }
  function copyHtml(html, text) {
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        var item = new window.ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text || ''], { type: 'text/plain' }) });
        return navigator.clipboard.write([item]).then(function () { return true; }, function () { return copy(text || html); });
      }
    } catch (e) { /* fall through */ }
    return copy(text || html);
  }
  function mailto(to, subject, body) {
    var href = 'mailto:' + encodeURIComponent(to || '') + '?subject=' + encodeURIComponent(subject || '') + '&body=' + encodeURIComponent(body || '');
    if (typeof window !== 'undefined') window.location.href = href;
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/html' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  return {
    info: info,
    settings: function () { return min('settings'); },
    saveSettings: function (s) { return min('settings', 'POST', s); },
    list: function () { return min('list'); },
    get: function (id) { return min('get?id=' + encodeURIComponent(id || '')); },
    save: function (m) { return min('save', 'POST', m); },
    remove: function (id) { return min('remove', 'POST', { id: id }); },
    dictate: function (base64, m) { return min('dictate', 'POST', { audioBase64: base64, mime: m }); },
    teams: function (payload) { return min('teams', 'POST', payload); },
    // Ask AI (shared with the SQL worksheet): the key stays in the desktop app.
    aiSettings: function () { return sql('ai/settings'); },
    aiSave: function (form) { return sql('ai/settings', 'POST', form); },
    aiModels: function (provider) { return sql('ai/models', 'POST', { provider: provider }); },
    aiChat: function (system, user) { return sql('ai/chat', 'POST', { system: system, user: user }); },
    recording: recording, startRec: startRec, stopRec: stopRec, cancelRec: cancelRec,
    copy: copy, copyHtml: copyHtml, mailto: mailto, download: download
  };
});
