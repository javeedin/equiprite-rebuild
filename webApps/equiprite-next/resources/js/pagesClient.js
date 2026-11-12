define([], function () {
  'use strict';

  // The Application pages catalog, for its screen and for Jira stories (desktop/lib/pages.js writes it). Reading works
  // everywhere: the local server (desktop app or npm run serve) answers with a fresh scan of the code, and elsewhere
  // (VBCS) the catalog, sheets and screenshots shipped with the app (resources/pages, kept in git) are read. Building a
  // sheet, mapping a story, a screenshot, the AI text and git go to the local server (/__pages/*, X-EquipRite-Pages).
  // Each call resolves { ok, status, body } and never throws.

  function rel(base, p) { var b = base || ''; if (b && b.charAt(b.length - 1) !== '/') b += '/'; return b + p; }
  function fileOf(id) { return String(id || '').split('/').map(function (x) { return x || '_root'; }).join('.'); }
  function getJson(url) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: {} });
    return window.fetch(url, { cache: 'no-store', credentials: 'same-origin' }).then(function (r) {
      return r.text().then(function (t) { var b = null; try { b = t ? JSON.parse(t) : null; } catch (e) { b = null; } return { ok: r.ok && !!b, status: r.status, body: b || {} }; });
    }, function () { return { ok: false, status: 0, body: {} }; });
  }
  function call(path, method, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    var opts = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-EquipRite-Pages': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch('/__pages/' + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = { error: r.ok ? 'An answer that is not JSON.' : 'HTTP ' + r.status }; }
        return { ok: r.ok && !!b && b.ok !== false && !b.error, status: r.status, body: b || {} };
      });
    }, function (e) { return { ok: false, status: 0, body: { error: 'The local server did not answer: ' + ((e && e.message) || e) } }; });
  }

  var local = null; // whether the local server answers (asked once)
  function info() {
    return call('info').then(function (r) {
      local = r.status === 200 && !!r.body.ok;
      return { available: local, canWrite: !!(local && r.body.canWrite), canCapture: !!(local && r.body.canCapture) };
    });
  }
  function hasLocal() { return local === null ? info().then(function (i) { return i.available; }) : Promise.resolve(local); }

  function catalog(base) {
    return hasLocal().then(function (yes) {
      if (yes) return call('catalog').then(function (r) { return r.ok ? r : getJson(rel(base, 'resources/pages/catalog.json') + '?t=' + Date.now()); });
      return getJson(rel(base, 'resources/pages/catalog.json') + '?t=' + Date.now());
    }).then(function (r) { var b = r.body || {}; return { ok: r.ok, status: r.status, body: { pages: Array.isArray(b.pages) ? b.pages : [], scannedAt: b.scannedAt || '' } }; });
  }

  /** One page's sheet: { sheet, codeChanged, saved } (in VBCS only a saved sheet can be read). */
  function sheet(base, id) {
    return hasLocal().then(function (yes) {
      if (yes) return call('sheet?id=' + encodeURIComponent(id));
      return getJson(rel(base, 'resources/pages/sheets/' + fileOf(id) + '.json') + '?t=' + Date.now()).then(function (r) {
        return r.ok ? { ok: true, status: 200, body: { ok: true, sheet: r.body, saved: true, codeChanged: false } } : { ok: false, status: r.status, body: { error: 'This page has no technical sheet yet. Sheets are built in the desktop app.' } };
      });
    });
  }

  /** The screenshot's address (as the app serves it), with a stamp so a new one is not cached. */
  function shotUrl(base, shot) { return shot && shot.file ? rel(base, 'resources/pages/' + shot.file) + '?t=' + encodeURIComponent(shot.at || '') : ''; }

  /** A File (from <input type="file">) → base64. */
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).replace(/^data:[^,]*,/, '')); };
      fr.onerror = function () { reject(new Error('Could not read the file.')); };
      fr.readAsDataURL(file);
    });
  }

  return {
    info: info, catalog: catalog, sheet: sheet, shotUrl: shotUrl, readFile: readFile, fileOf: fileOf,
    build: function (id, commit) { return call('build', 'POST', { id: id, commit: !!commit }); },
    assign: function (id, key, commit) { return call('assign', 'POST', { id: id, key: key, commit: !!commit }); },
    unassign: function (id, key, commit) { return call('unassign', 'POST', { id: id, key: key, commit: !!commit }); },
    upload: function (id, base64, mime, commit) { return call('shot', 'POST', { id: id, base64: base64, mime: mime, commit: !!commit }); },
    capture: function (id, commit) { return call('capture', 'POST', { id: id, commit: !!commit }); },
    saveAi: function (id, text, provider, commit) { return call('ai', 'POST', { id: id, text: text, provider: provider, commit: !!commit }); },
    rescan: function (commit) { return call('rescan', 'POST', { commit: !!commit }); },
    gitStatus: function () { return call('git/status'); },
    gitSave: function (message) { return call('git/save', 'POST', { message: message || 'Application pages: update' }); }
  };
});
