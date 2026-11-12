define([], function () {
  'use strict';

  // The FDD library, for the FDD library page and "Analyze with AI". Reading needs nothing but the app: the library and
  // each document's sections ship with it (resources/fdd/library.json and resources/fdd/<id>.json, kept in git), so it
  // works in the desktop app, in the browser (npm run serve) and in VBCS. Uploading, making one the latest, removing and
  // committing to git go to the local server (desktop/lib/fdd.js at /__fdd/*, this PC only, behind X-EquipRite-FDD),
  // which writes into the project. Each call resolves { ok, status, body } and never throws.

  var docs = {}; // id → the loaded document, kept while the app runs (a document is read once)

  function rel(base, p) {
    var b = base || '';
    if (b && b.charAt(b.length - 1) !== '/') b += '/';
    return b + p;
  }
  function getJson(url) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    return window.fetch(url, { cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = null; }
        return { ok: r.ok && !!b, status: r.status, body: b || { error: 'HTTP ' + r.status } };
      });
    }, function (e) { return { ok: false, status: 0, body: { error: String((e && e.message) || e) } }; });
  }
  function call(path, method, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    var opts = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-EquipRite-FDD': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch('/__fdd/' + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = { error: r.ok ? 'An answer that is not JSON.' : 'HTTP ' + r.status }; }
        return { ok: r.ok && !!b && b.ok !== false && !b.error, status: r.status, body: b || {} };
      });
    }, function (e) { return { ok: false, status: 0, body: { error: 'The local server did not answer: ' + ((e && e.message) || e) } }; });
  }

  /** The library { latest, docs } shipped with the app ({ latest: '', docs: [] } when there is none yet). */
  function library(base) {
    return getJson(rel(base, 'resources/fdd/library.json') + '?t=' + Date.now()).then(function (r) {
      var b = r.ok ? r.body : {};
      return { ok: r.ok, status: r.status, body: { latest: String(b.latest || ''), docs: Array.isArray(b.docs) ? b.docs : [] } };
    });
  }
  /** One document with its sections; read once per id and `stamp` (its uploadedAt, so a re-upload is read again). */
  function doc(base, id, stamp) {
    if (!id) return Promise.resolve({ ok: false, status: 0, body: { error: 'No FDD chosen.' } });
    var k = id + '|' + (stamp || '');
    if (docs[k]) return Promise.resolve({ ok: true, status: 200, body: docs[k] });
    return getJson(rel(base, 'resources/fdd/' + encodeURIComponent(id) + '.json') + '?t=' + encodeURIComponent(stamp || '')).then(function (r) {
      if (r.ok && r.body && Array.isArray(r.body.sections)) docs[k] = r.body;
      else if (r.ok) return { ok: false, status: r.status, body: { error: 'The FDD "' + id + '" has no sections.' } };
      return r;
    });
  }

  /** Whether uploading works here (the local server answers /__fdd/info and runs from the project folder). */
  function info() {
    return call('info').then(function (r) {
      var b = r.body || {};
      return { available: r.status === 200 && !!b.ok, canUpload: !!(b.ok && b.canUpload), body: b };
    });
  }

  /** A File (from <input type="file">) → base64, for upload. */
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).replace(/^data:[^,]*,/, '')); };
      fr.onerror = function () { reject(new Error('Could not read the file.')); };
      fr.readAsDataURL(file);
    });
  }

  /** The document as uploaded, saved by the browser (the server sends it; a link cannot carry the header). */
  function download(id) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve(false);
    return window.fetch('/__fdd/original?id=' + encodeURIComponent(id), { headers: { 'X-EquipRite-FDD': '1' }, credentials: 'same-origin' }).then(function (r) {
      if (!r.ok) return false;
      var cd = r.headers.get('Content-Disposition') || '';
      var name = (/filename="([^"]+)"/.exec(cd) || [])[1] || id;
      return r.blob().then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = decodeURIComponent(name); document.body.appendChild(a); a.click();
        setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
        return true;
      });
    }, function () { return false; });
  }

  return {
    library: library,
    doc: doc,
    info: info,
    readFile: readFile,
    download: download,
    upload: function (b) { return call('upload', 'POST', b || {}); },
    setLatest: function (id, commit) { return call('latest', 'POST', { id: id, commit: !!commit, push: true }); },
    remove: function (id, commit) { return call('remove', 'POST', { id: id, commit: !!commit, push: true }); },
    outline: function (id) { return call('outline?id=' + encodeURIComponent(id || '')); },
    gitStatus: function () { return call('git/status'); },
    gitSave: function (b) { return call('git/save', 'POST', b || {}); },
    forget: function () { docs = {}; }
  };
});
