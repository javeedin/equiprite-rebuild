define([], function () {
  'use strict';

  // Record, on a Jira story's panel (Old EquipRite's Jira Stories and EquipRite Next's Jira stories; Old and Next keep
  // identical copies of this file): a screen recording and screenshots of a test, kept on this PC in the story's folder
  // by the desktop app (desktop/lib/testEvidence.js, /__rec/*), listed on the story's panel.
  //
  //   begin(key, 'record' | 'shot')  the picker (which screen or window), then Record or one Screenshot
  //   shot()                         a screenshot of what is being recorded (also Ctrl+Alt+S from any app)
  //   stop()                         the recording ends and is saved (also Ctrl+Alt+X, or stopping the share)
  //   list(key), reveal(key)         the story's evidence; its folder opened
  //   onChange(name, fn)             fn({ key, item }) after something is saved (one listener per name: a page's)
  //   state()                        { recording, key, seconds, shots }
  //   keepFocus(selector)            focus back on the panel after the picker or the bar has gone
  //
  // The recorder, its picker and its bar live on document.body, outside any page, so the recording goes on while the
  // person moves between tabs and pages, or minimises EquipRite to test in another window. The video goes to the
  // desktop app every few seconds (MediaRecorder timeslice), so a long test does not sit in memory. Desktop app only:
  // in a browser there is no folder to keep it in, and available() says so.

  var CHUNK_MS = 3000;
  var MIMES = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  var listeners = {};
  var rec = null; // { key, id, stream, recorder, video, queue, started, shots, timer, bar, keys }

  function txt(v) { return v == null ? '' : String(v); }
  function desk() {
    return typeof window !== 'undefined' && window.erpDesktop && typeof window.erpDesktop.recordSources === 'function' ? window.erpDesktop : null;
  }
  function headers(extra) { return Object.assign({ 'X-EquipRite-Rec': '1' }, extra || {}); }
  async function getJson(url) {
    try {
      var r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      return r.ok ? await r.json() : null;
    } catch (e) {
      return null;
    }
  }
  async function post(url, body, type) {
    var r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: headers(type ? { 'Content-Type': type } : {}), body: body || null });
    var j = r.ok ? await r.json() : { error: 'HTTP ' + r.status };
    if (j && j.error) throw new Error(j.error);
    return j;
  }
  function notify(change) {
    Object.keys(listeners).forEach(function (k) { try { listeners[k](change); } catch (e) { /* a page that is gone */ } });
  }

  /** Recording here: the desktop app, with its evidence store. */
  async function available() {
    if (!desk()) return false;
    var info = await getJson('/__rec/info');
    return !!(info && info.available);
  }

  /** A story's recordings and screenshots: { key, folder, items: [{ name, kind, size, created, url }] } or { error }. */
  async function list(key) {
    var j = await getJson('/__rec/list?key=' + encodeURIComponent(key));
    return j || { key: key, folder: '', items: [], error: 'The desktop app did not answer.' };
  }

  async function reveal(key) { return post('/__rec/reveal?key=' + encodeURIComponent(key)); }

  function onChange(name, fn) { if (typeof fn === 'function') listeners[name] = fn; else delete listeners[name]; }

  /** After the picker or the bar is gone (focus with them), focus back in the panel, so Escape still closes it. */
  function keepFocus(selector) {
    setTimeout(function () {
      var a = document.activeElement;
      if (a && a !== document.body && a.isConnected) return;
      var t = document.querySelector(selector);
      if (!t) return;
      var b = t.querySelector('button') || t;
      try { b.focus({ preventScroll: true }); } catch (e) { /* not focusable */ }
    }, 60);
  }

  function state() {
    return { recording: !!rec, key: rec ? rec.key : '', seconds: rec ? Math.floor((Date.now() - rec.started) / 1000) : 0, shots: rec ? rec.shots : 0 };
  }

  // ── what the person sees: the picker and the bar (plain DOM on document.body, styled once) ──
  var CSS = [
    '.eqr-rec-veil{position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;font:14px/1.4 system-ui,Segoe UI,sans-serif}',
    '.eqr-rec-box{width:min(760px,94vw);max-height:88vh;overflow:auto;background:#fff;color:#111827;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.35);padding:20px}',
    '.eqr-rec-box h2{margin:0 0 4px;font-size:18px}.eqr-rec-box p{margin:4px 0 12px;color:#4b5563}',
    '.eqr-rec-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;margin:8px 0 14px}',
    '.eqr-rec-src{border:2px solid #e5e7eb;border-radius:8px;padding:6px;background:#fff;cursor:pointer;text-align:left;font:inherit;color:inherit}',
    '.eqr-rec-src[aria-pressed=true]{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.2)}',
    '.eqr-rec-src img{display:block;width:100%;height:100px;object-fit:cover;background:#f3f4f6;border-radius:4px}',
    '.eqr-rec-src span{display:block;margin-top:4px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.eqr-rec-row{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}',
    '.eqr-rec-btn{border:1px solid #d1d5db;background:#fff;color:#111827;border-radius:8px;padding:8px 14px;font:inherit;font-weight:600;cursor:pointer}',
    '.eqr-rec-btn--go{background:#b91c1c;border-color:#b91c1c;color:#fff}.eqr-rec-btn:disabled{opacity:.5;cursor:default}',
    '.eqr-rec-bar{position:fixed;right:18px;bottom:18px;z-index:2147483001;display:flex;align-items:center;gap:10px;padding:8px 10px 8px 14px;border-radius:999px;',
    'background:#111827;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.35);font:13px/1.2 system-ui,Segoe UI,sans-serif}',
    '.eqr-rec-dot{width:10px;height:10px;border-radius:50%;background:#ef4444;animation:eqr-rec-blink 1s infinite}',
    '@keyframes eqr-rec-blink{50%{opacity:.25}}',
    '.eqr-rec-bar button{border:0;border-radius:999px;padding:6px 12px;font:inherit;font-weight:700;cursor:pointer}',
    '.eqr-rec-bar .eqr-rec-shot{background:#374151;color:#fff}.eqr-rec-bar .eqr-rec-stop{background:#ef4444;color:#fff}',
    '.eqr-rec-hint{font-size:11px;color:#9ca3af}.eqr-rec-flash{color:#86efac;font-weight:700}'
  ].join('');
  function styleOnce() {
    if (document.getElementById('eqrRecStyle')) return;
    var st = document.createElement('style');
    st.id = 'eqrRecStyle';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function clock(s) { var m = Math.floor(s / 60); return (m < 10 ? '0' : '') + m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }

  /** The picker: which screen or window, and (to record) whether EquipRite steps aside. Resolves { id, minimize } or null. */
  async function pick(key, mode) {
    styleOnce();
    var sources = [];
    try { sources = await desk().recordSources(); } catch (e) { sources = []; }
    sources.sort(function (a, b) { return (a.kind === 'screen' ? 0 : 1) - (b.kind === 'screen' ? 0 : 1); });
    return new Promise(function (resolve) {
      var veil = el('div', { class: 'eqr-rec-veil', id: 'eqrRecPicker', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose what to record' });
      var box = el('div', { class: 'eqr-rec-box' });
      box.appendChild(el('h2', {}, mode === 'shot' ? 'Screenshot for ' + key : 'Record your test of ' + key));
      box.appendChild(el('p', {}, mode === 'shot' ? 'Pick the screen or window to capture.'
        : 'Pick the screen (or one window) to record. Log in and test as usual: a bar keeps the time, takes screenshots and stops. '
          + 'Ctrl+Alt+S takes a screenshot and Ctrl+Alt+X stops, from any app. It is saved in this story\'s folder on this PC.'));
      var grid = el('div', { class: 'eqr-rec-grid' });
      var chosen = sources.length ? sources[0].id : '';
      sources.forEach(function (s) {
        var b = el('button', { type: 'button', class: 'eqr-rec-src', 'data-id': s.id, 'aria-pressed': s.id === chosen ? 'true' : 'false', title: s.name });
        if (s.thumb) b.appendChild(el('img', { src: s.thumb, alt: '' }));
        b.appendChild(el('span', {}, (s.kind === 'screen' ? 'Screen · ' : '') + s.name));
        b.addEventListener('click', function () {
          chosen = s.id;
          grid.querySelectorAll('.eqr-rec-src').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        });
        grid.appendChild(b);
      });
      if (!sources.length) grid.appendChild(el('p', {}, 'No screen to record was found.'));
      box.appendChild(grid);
      var row = el('div', { class: 'eqr-rec-row' });
      var minLabel = el('label', {});
      var min = el('input', { type: 'checkbox', id: 'eqrRecMinimize' });
      min.checked = mode !== 'shot';
      minLabel.appendChild(min);
      minLabel.appendChild(document.createTextNode(' Minimise EquipRite when it starts'));
      if (mode !== 'shot') row.appendChild(minLabel); else row.appendChild(el('span', {}));
      var btns = el('div', {});
      var cancel = el('button', { type: 'button', class: 'eqr-rec-btn', id: 'eqrRecCancel' }, 'Cancel');
      var go = el('button', { type: 'button', class: 'eqr-rec-btn eqr-rec-btn--go', id: 'eqrRecGo' }, mode === 'shot' ? 'Take the screenshot' : '● Start recording');
      if (!sources.length) go.disabled = true;
      btns.appendChild(cancel);
      btns.appendChild(document.createTextNode(' '));
      btns.appendChild(go);
      row.appendChild(btns);
      box.appendChild(row);
      veil.appendChild(box);
      document.body.appendChild(veil);
      var done = function (v) { veil.remove(); document.removeEventListener('keydown', esc, true); resolve(v); };
      var esc = function (e) { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
      document.addEventListener('keydown', esc, true);
      cancel.addEventListener('click', function () { done(null); });
      go.addEventListener('click', function () { done({ id: chosen, minimize: min.checked }); });
      go.focus();
    });
  }

  async function stream(sourceId) {
    await desk().recordUse(sourceId);
    return navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
  }

  /** A frame of a playing stream, as a PNG. */
  async function frame(video) {
    if (video.readyState < 2) await new Promise(function (r) { video.onloadeddata = r; setTimeout(r, 1500); });
    var c = document.createElement('canvas');
    c.width = video.videoWidth || 1280;
    c.height = video.videoHeight || 720;
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return new Promise(function (r) { c.toBlob(r, 'image/png'); });
  }
  function videoOf(s) {
    var v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = s;
    var p = v.play();
    if (p && p.catch) p.catch(function () { /* plays once data arrives */ });
    return v;
  }

  async function saveShot(key, blob) {
    var j = await post('/__rec/image?key=' + encodeURIComponent(key) + '&ext=png', blob, 'image/png');
    notify({ key: key, item: j.item });
    return j.item;
  }

  function bar() {
    styleOnce();
    var b = el('div', { class: 'eqr-rec-bar', id: 'eqrRecBar', role: 'status', 'aria-live': 'polite' });
    b.appendChild(el('span', { class: 'eqr-rec-dot', 'aria-hidden': 'true' }));
    var time = el('strong', { id: 'eqrRecTime' }, '00:00');
    b.appendChild(time);
    var what = el('span', { id: 'eqrRecWhat' }, rec.key);
    b.appendChild(what);
    var shotB = el('button', { type: 'button', class: 'eqr-rec-shot', id: 'eqrRecShot', title: 'Screenshot (' + rec.keys.shot + ')' }, '📷 Screenshot');
    var stopB = el('button', { type: 'button', class: 'eqr-rec-stop', id: 'eqrRecStop', title: 'Stop and save (' + rec.keys.stop + ')' }, '■ Stop');
    shotB.addEventListener('click', function () { shot(); });
    stopB.addEventListener('click', function () { stop(); });
    b.appendChild(shotB);
    b.appendChild(stopB);
    b.appendChild(el('span', { class: 'eqr-rec-hint' }, rec.keys.shot + ' · ' + rec.keys.stop));
    document.body.appendChild(b);
    rec.timer = setInterval(function () {
      time.textContent = clock(Math.floor((Date.now() - rec.started) / 1000));
    }, 500);
    return { el: b, what: what };
  }

  /** Begins: the picker, then a recording ('record') or one screenshot ('shot'). Resolves what was done, or null. */
  async function begin(key, mode) {
    if (!desk()) throw new Error('Recording works in the EquipRite desktop app.');
    if (rec) { if (mode === 'shot') return shot(); throw new Error('A recording of ' + rec.key + ' is already running: stop it first.'); }
    var choice = await pick(key, mode);
    if (!choice) return null;
    if (mode === 'shot') {
      var s = await stream(choice.id);
      var v = videoOf(s);
      try { return await saveShot(key, await frame(v)); } finally { s.getTracks().forEach(function (t) { t.stop(); }); }
    }
    return start(key, choice);
  }

  async function start(key, choice) {
    var s = await stream(choice.id);
    var mime = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported)
      ? MIMES.filter(function (m) { return MediaRecorder.isTypeSupported(m); })[0] : '';
    var ext = /^video\/mp4/.test(mime || '') ? 'mp4' : 'webm';
    var j = await post('/__rec/start?key=' + encodeURIComponent(key) + '&ext=' + ext);
    var recorder = new MediaRecorder(s, mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : {});
    rec = { key: key, id: j.id, name: j.name, stream: s, recorder: recorder, video: videoOf(s), queue: Promise.resolve(), started: Date.now(), shots: 0,
      keys: { shot: 'Ctrl+Alt+S', stop: 'Ctrl+Alt+X' }, error: '' };
    recorder.ondataavailable = function (e) {
      if (!e.data || !e.data.size || !rec) return;
      var id = rec.id;
      rec.queue = rec.queue.then(function () { return post('/__rec/chunk?id=' + encodeURIComponent(id), e.data, 'application/octet-stream'); })
        .catch(function (err) { if (rec) rec.error = txt(err && err.message); });
    };
    s.getVideoTracks().forEach(function (t) { t.addEventListener('ended', function () { if (rec) stop(); }); });
    recorder.start(CHUNK_MS);
    try { rec.keys = await desk().recordState(true) || rec.keys; } catch (e) { /* no shortcuts: the bar still works */ }
    desk().onRecordKey(function (what) { if (what === 'shot') shot(); else if (what === 'stop') stop(); });
    rec.bar = bar();
    notify({ key: key, recording: true });
    if (choice.minimize) { try { await desk().recordWindow('minimize'); } catch (e) { /* stays */ } }
    return { recording: true, key: key, name: j.name };
  }

  /** A screenshot of what is being recorded, saved in the story's folder at once. */
  async function shot() {
    if (!rec) return null;
    var r = rec;
    var item = await saveShot(r.key, await frame(r.video));
    r.shots++;
    if (r.bar) {
      r.bar.what.innerHTML = '';
      r.bar.what.appendChild(el('span', { class: 'eqr-rec-flash' }, 'Screenshot ' + r.shots + ' saved'));
      setTimeout(function () { if (rec === r && r.bar) r.bar.what.textContent = r.key + ' · ' + r.shots + (r.shots === 1 ? ' screenshot' : ' screenshots'); }, 1600);
    }
    return item;
  }

  /** Stops: the last seconds written, the file closed, EquipRite back in front. Resolves the saved recording. */
  async function stop() {
    if (!rec || rec.stopping) return null;
    var r = rec;
    r.stopping = true;
    await new Promise(function (resolve) {
      if (r.recorder.state === 'inactive') { resolve(); return; }
      r.recorder.addEventListener('stop', function () { resolve(); }, { once: true });
      r.recorder.stop();
    });
    await r.queue;
    var j = null;
    try { j = await post('/__rec/finish?id=' + encodeURIComponent(r.id) + '&key=' + encodeURIComponent(r.key)); } catch (e) { r.error = txt(e && e.message); }
    r.stream.getTracks().forEach(function (t) { t.stop(); });
    clearInterval(r.timer);
    if (r.bar) r.bar.el.remove();
    rec = null;
    try { await desk().recordState(false); } catch (e) { /* none */ }
    try { await desk().recordWindow('restore'); } catch (e) { /* none */ }
    notify({ key: r.key, item: j && j.item, recording: false, error: r.error });
    return j && j.item;
  }

  return { available: available, list: list, reveal: reveal, begin: begin, shot: shot, stop: stop, onChange: onChange, state: state, keepFocus: keepFocus,
    CHUNK_MS: CHUNK_MS };
});
