define([], function () {
  'use strict';

  // Saved AI analyses, for "Analyze with AI" and the Jira lists' AI icon. The desktop app (or npm run serve) keeps them
  // on this PC (desktop/lib/analyses.js at /__ai/*, behind X-EquipRite-AI); where there is no such server (VBCS) this
  // browser keeps them (localStorage). Either way the calls are the same and never throw.
  //
  //   index()              { KEY: { at, by, provider, fddLabel, kind, keys, storyUpdated, chat } } — read, and remembered
  //   cached()             the index as last read (what the lists' icons bind to)
  //   get(key)             the saved analysis { key, text, provider, fddId, fddLabel, picked, chat, at, by, … } or null
  //   save(item)           keeps a run (replacing the last) → the saved item (with at, by), or null
  //   saveChat(key, chat)  keeps the conversation with it
  //   setKey(keys)         "SET:EQP-12,EQP-13" for a set of stories (sorted)
  //   on(id, fn)           fn(index) whenever the index changes (a list keeps its icons current); one per id
  //   when(at)             "12 Nov 2026, 19:24"; ago(at) "2 hours ago"

  var LS = 'eqr-ai-analyses';
  var mode = '';      // 'server' | 'local'
  var cache = {};
  var listeners = {};

  function call(path, method, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: {} });
    var opts = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-EquipRite-AI': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch('/__ai/' + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = null; }
        return { ok: r.ok && !!b && b.ok !== false, status: r.status, body: b || {} };
      });
    }, function () { return { ok: false, status: 0, body: {} }; });
  }
  function lsRead() { try { var j = JSON.parse(window.localStorage.getItem(LS) || '{}'); return j && typeof j === 'object' ? j : {}; } catch (e) { return {}; } }
  function lsWrite(all) {
    try {
      var keys = Object.keys(all).sort(function (a, b) { return String(all[b].at).localeCompare(String(all[a].at)); });
      keys.slice(300).forEach(function (k) { delete all[k]; }); // a browser keeps the newest 300
      window.localStorage.setItem(LS, JSON.stringify(all));
      return true;
    } catch (e) { return false; }
  }
  function summary(it) { return { at: it.at, by: it.by || '', provider: it.provider || '', fddLabel: it.fddLabel || '', kind: it.kind, keys: it.keys, storyUpdated: it.storyUpdated || '', chat: (it.chat || []).length }; }
  function keyOf(k) {
    var s = String(k || '').trim().toUpperCase();
    if (/^SET:/.test(s)) return setKey(s.slice(4).split(/[\s,]+/));
    return /^[A-Z][A-Z0-9]*-\d+$/.test(s) ? s : '';
  }
  function setKey(keys) {
    var list = (keys || []).map(function (k) { return String(k || '').trim().toUpperCase(); }).filter(function (k) { return /^[A-Z][A-Z0-9]*-\d+$/.test(k); });
    list = list.filter(function (k, i) { return list.indexOf(k) === i; }).sort();
    return list.length > 1 ? 'SET:' + list.join(',') : (list[0] || '');
  }
  function notify() {
    Object.keys(listeners).forEach(function (id) { try { listeners[id](cache); } catch (e) { /* a closed tab's page */ } });
  }

  function detect() {
    if (mode) return Promise.resolve(mode);
    return call('index').then(function (r) {
      if (r.status === 200 && r.body && r.body.ok) { mode = 'server'; cache = r.body.items || {}; }
      else { mode = 'local'; var all = lsRead(); cache = {}; Object.keys(all).forEach(function (k) { cache[k] = summary(all[k]); }); }
      return mode;
    });
  }

  function index() {
    return detect().then(function () {
      if (mode === 'server') return call('index').then(function (r) { if (r.ok) cache = r.body.items || {}; notify(); return cache; });
      var all = lsRead(); cache = {}; Object.keys(all).forEach(function (k) { cache[k] = summary(all[k]); });
      notify();
      return cache;
    });
  }

  function get(key) {
    var k = keyOf(key);
    if (!k) return Promise.resolve(null);
    return detect().then(function () {
      if (mode === 'server') return call('get?key=' + encodeURIComponent(k)).then(function (r) { return r.ok && r.body.item ? r.body.item : null; });
      return lsRead()[k] || null;
    });
  }

  function save(item) {
    var b = item || {};
    var k = keyOf(b.key);
    if (!k || !String(b.text || '').trim()) return Promise.resolve(null);
    return detect().then(function () {
      if (mode === 'server') {
        return call('save', 'POST', Object.assign({}, b, { key: k })).then(function (r) {
          if (!r.ok || !r.body.item) return null;
          cache = Object.assign({}, cache); cache[k] = summary(r.body.item); notify();
          return r.body.item;
        });
      }
      var all = lsRead();
      var it = Object.assign({}, b, { key: k, kind: /^SET:/.test(k) ? 'set' : 'story', keys: /^SET:/.test(k) ? k.slice(4).split(',') : [k], at: new Date().toISOString(), by: b.by || '' });
      all[k] = it;
      if (!lsWrite(all)) return null;
      cache = Object.assign({}, cache); cache[k] = summary(it); notify();
      return it;
    });
  }

  function saveChat(key, chat) {
    var k = keyOf(key);
    var list = (chat || []).map(function (m) { return { role: m.role, text: m.text }; });
    if (!k) return Promise.resolve(false);
    return detect().then(function () {
      if (mode === 'server') return call('chat', 'POST', { key: k, chat: list }).then(function (r) { return r.ok; });
      var all = lsRead();
      if (!all[k]) return false;
      all[k].chat = list;
      return lsWrite(all);
    });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function when(at) {
    var d = new Date(at);
    if (isNaN(d.getTime())) return '';
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    return d.getDate() + ' ' + mon + ' ' + d.getFullYear() + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function ago(at) {
    var t = Date.parse(at);
    if (isNaN(t)) return '';
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    var say = function (k, u) { return k + ' ' + u + (k === 1 ? '' : 's') + ' ago'; };
    if (m < 1) return 'just now';
    if (m < 60) return say(m, 'minute');
    if (m < 1440) return say(Math.round(m / 60), 'hour');
    var d = Math.round(m / 1440);
    return d < 30 ? say(d, 'day') : (d < 365 ? say(Math.round(d / 30), 'month') : say(Math.round(d / 365), 'year'));
  }

  return {
    index: index, cached: function () { return cache; }, get: get, save: save, saveChat: saveChat, setKey: setKey, keyOf: keyOf,
    on: function (id, fn) { if (fn) listeners[id] = fn; else delete listeners[id]; }, when: when, ago: ago,
    _reset: function () { mode = ''; cache = {}; listeners = {}; }
  };
});
