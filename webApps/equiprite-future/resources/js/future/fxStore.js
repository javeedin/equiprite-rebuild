define(['resources/js/future/fxSeed', 'resources/js/future/fxEngine', 'resources/js/future/fxViews'], function (Seed, Engine, Views) {
  'use strict';

  /**
   * EquipRite Future's store: the simulated backend's state. One state, changed only by act(), read by view().
   * Screens subscribe and refresh when anything changes (in this tab, another tab, or a restored snapshot).
   *
   * Where the story is kept:
   *   - in the desktop app: DuckDB in the app's data folder (desktop/lib/futureDb.js, /__future/*): every change is
   *     saved there, with the last 50 saves and named snapshots, and the story as SQL tables;
   *   - always also in this browser (localStorage), so it opens at once and works without the desktop app (VBCS).
   *   The newer of the two wins when the app opens. A story saved by an older version is upgraded, never thrown away
   *   (a copy is kept before anything is replaced).
   *
   *   act(type, payload) → { ok, error, result }        view(name, ...args) → the screen's view model (fxViews)
   *   reset() → the demo group again (the old story kept as a snapshot first)
   *   snapshots(), saveSnapshot(name), restoreSnapshot(id), deleteSnapshot(id), history(), restoreHistory(seq),
   *   exportStory(), importStory(text), sql(query), where()  (Promises; the DuckDB ones need the desktop app)
   */
  var KEY = 'equiprite-future:state:v3';
  var BACKUP = 'equiprite-future:backup';
  var state = null;
  var listeners = [];
  var server = { checked: false, available: false, timer: null, info: null };

  function now() { return Date.now(); }
  function current() { return Seed.seed().version; }

  /** A story from an older version, brought up to this one (new fields from the seed, nothing removed). */
  function upgrade(s) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.requests)) return null;
    var fresh = Seed.seed();
    if ((s.version || 0) > fresh.version) return null;
    if ((s.version || 0) === fresh.version) return s;
    var byId = {};
    fresh.agreements.forEach(function (a) { byId[a.id] = a; });
    (s.agreements || []).forEach(function (a) {
      var f = byId[a.id];
      if (!f) return;
      if (!a.billing) a.billing = f.billing || 'DAILY';
      if (a.minHours == null && f.minHours != null) a.minHours = f.minHours;
      if (!a.versions || !a.versions.length) a.versions = f.versions;
      Object.keys(a.rates || {}).forEach(function (k) {
        if (a.rates[k] && a.rates[k].hour == null) a.rates[k].hour = f.rates && f.rates[k] && f.rates[k].hour != null ? f.rates[k].hour : Math.round(a.rates[k].day / 8 * 100) / 100;
      });
    });
    // Version 5: credit control. A customer's hold has its reason; the name no longer says "(credit hold)".
    var custs = {};
    fresh.customers.forEach(function (c) { custs[c.id] = c; });
    (s.customers || []).forEach(function (c) {
      var f = custs[c.id];
      if (f && c.name === f.name + ' (credit hold)') c.name = f.name;
      if (f && c.onHold && c.holdReason == null) c.holdReason = f.holdReason || '';
    });
    (s.agreements || []).forEach(function (a) { var f = byId[a.id]; if (f && a.terms === 'On credit hold.') a.terms = f.terms; });
    (s.requests || []).forEach(function (r) {
      (r.lines || []).forEach(function (l) {
        if (l.price && !l.price.billing) {
          var ag = (s.agreements || []).filter(function (a) { return a.id === l.agreementId; })[0];
          l.price.billing = (ag && ag.billing) || 'DAILY';
          if (l.price.hour == null) l.price.hour = Math.round(l.price.day / 8 * 100) / 100;
          if (ag && ag.minHours) l.price.minHours = ag.minHours;
        }
      });
    });
    Object.keys(fresh.settings).forEach(function (k) { if (!(k in (s.settings || {}))) s.settings[k] = fresh.settings[k]; });
    Object.keys(fresh.seq).forEach(function (k) { if (!(k in (s.seq || {}))) s.seq[k] = fresh.seq[k]; });
    ['hours', 'breakdowns', 'charges', 'statements', 'tx', 'customs', 'notifications', 'log'].forEach(function (k) { if (!Array.isArray(s[k])) s[k] = []; });
    s.upgradedFrom = s.version || 0;
    s.version = fresh.version;
    return s;
  }

  function keepBackup(raw, why) {
    try { if (raw && window.localStorage) window.localStorage.setItem(BACKUP, JSON.stringify({ at: new Date().toISOString(), why: why, story: raw })); } catch (e) { /* no room */ }
  }

  function load() {
    if (state) return state;
    var raw = null;
    try { raw = window.localStorage && window.localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var s = upgrade(JSON.parse(raw));
        if (s) state = s; else keepBackup(raw, 'A story this version could not read');
      } catch (e) { keepBackup(raw, 'A damaged story'); }
    }
    if (!state) state = Seed.seed();
    syncFromServer();
    return state;
  }

  function saveLocal() {
    try { if (window.localStorage) window.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode: the story lasts for this page only */ }
  }
  function save() {
    state.savedAt = now();
    saveLocal();
    if (server.available) {
      clearTimeout(server.timer);
      server.timer = setTimeout(pushToServer, 300);
    }
  }
  function emit(type) {
    listeners.slice().forEach(function (fn) { try { fn(type); } catch (e) { console.warn('[fxStore] listener', e); } });
  }

  // ── The desktop app's DuckDB ─────────────────────────────────────────────────────────────────────────────────────
  function canFetch() { return typeof window !== 'undefined' && typeof window.fetch === 'function' && /^https?:/.test(String(window.location && window.location.protocol)); }
  function api(path, opts) {
    if (!canFetch()) return Promise.reject(new Error('Not in a browser'));
    return window.fetch('/__future/' + path, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, opts || {})).then(function (r) {
      return r.text().then(function (t) {
        var body = null;
        try { body = t ? JSON.parse(t) : null; } catch (e) { body = undefined; }
        if (!r.ok) { var err = new Error((body && body.error) || ('HTTP ' + r.status)); err.status = r.status; throw err; }
        return body;
      });
    });
  }
  function pushToServer() {
    if (!server.available || !state) return;
    api('story', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) })
      .catch(function (e) { console.warn('[fxStore] the story was not saved to DuckDB (it is kept in this browser)', e.message); });
  }
  function syncFromServer() {
    if (server.checked || !canFetch()) return;
    server.checked = true;
    api('info').then(function (info) {
      // Only the desktop app's store answers with an engine; anything else (VBCS, a plain server) means: browser only.
      if (!info || (info.engine !== 'duckdb' && info.engine !== 'json')) { server.available = false; return null; }
      server.available = true;
      server.info = info;
      return api('story').then(function (remote) {
        var r = upgrade(remote);
        if (r && (!state.savedAt || (r.savedAt || 0) > state.savedAt)) {
          state = r;
          saveLocal();
          emit('sync');
        } else {
          pushToServer();
        }
      }, function () { pushToServer(); });
    }, function () { server.available = false; });
  }

  function get() { return load(); }
  function act(type, payload) {
    var res = Engine.apply(load(), type, payload);
    if (res.ok) {
      state = res.state;
      save();
      emit(type);
    }
    return { ok: res.ok, error: res.error || '', result: res.result || null };
  }
  function view(name) {
    var fn = Views[name];
    if (typeof fn !== 'function') throw new Error('No view ' + name);
    var args = [load()].concat(Array.prototype.slice.call(arguments, 1));
    return fn.apply(null, args);
  }
  function subscribe(fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (x) { return x !== fn; }); };
  }
  function replace(s, why) {
    var u = upgrade(s);
    if (!u) throw new Error('This is not a story EquipRite Future can open.');
    keepBackup(JSON.stringify(state), why || 'Replaced');
    state = u;
    save();
    emit('replace');
    return state;
  }
  function reset(opts) {
    var who = state ? state.personaId : 'p-pm';
    var before = state;
    if (opts && opts.erase) {
      // Everything goes: the story, its history and the snapshots (DuckDB), and this browser's copies.
      try { if (window.localStorage) window.localStorage.removeItem(BACKUP); } catch (e) { /* nothing kept */ }
      state = Seed.seed();
      state.personaId = who;
      state.savedAt = now();
      saveLocal();
      emit('reset');
      if (server.available) api('erase', { method: 'POST' }).then(pushToServer, function (e) { console.warn('[fxStore] DuckDB not erased', e.message); });
      return;
    }
    if (before && before.requests && before.requests.length) {
      keepBackup(JSON.stringify(before), 'Reset');
      if (server.available) api('snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Before the reset of ' + new Date().toLocaleString(), story: before }) }).catch(function () {});
    }
    state = Seed.seed();
    state.personaId = who;
    save();
    emit('reset');
  }

  // Snapshots, history, export and SQL.
  function where() {
    return server.available ? { kept: 'duckdb', text: 'Saved in DuckDB on this computer' + (server.info && server.info.file ? ' (' + server.info.file + ')' : '') + ', and in this browser', info: server.info }
      : { kept: 'browser', text: 'Saved in this browser only (open Future from the desktop app to keep it in DuckDB)', info: null };
  }
  function snapshots() { return api('snapshots'); }
  function saveSnapshot(name) { return api('snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, story: load() }) }); }
  function restoreSnapshot(id) { return api('snapshots/' + Number(id)).then(function (s) { return replace(s, 'Before restoring snapshot ' + id); }); }
  function deleteSnapshot(id) { return api('snapshots/' + Number(id), { method: 'DELETE' }); }
  function history() { return api('history'); }
  function restoreHistory(seq) { return api('history/' + Number(seq)).then(function (s) { return replace(s, 'Before restoring save ' + seq); }); }
  function exportStory() { return JSON.stringify(load(), null, 1); }
  function importStory(text) { return replace(JSON.parse(text), 'Before opening a story from a file'); }
  function sql(query) { return api('sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: query }) }); }
  function lastBackup() { try { var b = window.localStorage && window.localStorage.getItem(BACKUP); return b ? JSON.parse(b) : null; } catch (e) { return null; } }

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', function (e) {
      if (e.key !== KEY || !e.newValue) return;
      try { var s = upgrade(JSON.parse(e.newValue)); if (s) { state = s; emit('sync'); } } catch (x) { /* ignore a half-written value */ }
    });
  }

  return { get: get, act: act, view: view, subscribe: subscribe, reset: reset, replace: replace, upgrade: upgrade, where: where,
    snapshots: snapshots, saveSnapshot: saveSnapshot, restoreSnapshot: restoreSnapshot, deleteSnapshot: deleteSnapshot, history: history, restoreHistory: restoreHistory,
    exportStory: exportStory, importStory: importStory, sql: sql, lastBackup: lastBackup, KEY: KEY, fmt: Views.fmt, personas: Seed.PERSONAS };
});
