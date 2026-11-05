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
  //   openTrace(key, name)           a recording's technical trace: the video in step with what happened underneath (the
  //                                  web service calls with their JSON, console errors, pages), where it broke, a HAR
  //                                  file, a bug report to paste into Jira
  //
  // The technical trace (ticked in the picker): while recording, the desktop app keeps every web service call an
  // EquipRite window makes (desktop/lib/devserver.js) and their console errors (desktop/main.js), secrets masked
  // (desktop/lib/testTrace.js), next to the video. The bar counts the calls and the failures as they happen.
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
    '.eqr-rec-hint{font-size:11px;color:#9ca3af}.eqr-rec-flash{color:#86efac;font-weight:700}',
    '.eqr-rec-opts{display:flex;flex-direction:column;gap:4px}.eqr-rec-calls{font-size:12px;color:#cbd5e1}.eqr-rec-calls--bad{color:#fca5a5;font-weight:700}',
    // the technical trace: the video beside its timeline
    '.eqr-tr-veil{position:fixed;inset:0;z-index:2147483002;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;font:13px/1.45 system-ui,Segoe UI,sans-serif}',
    '.eqr-tr-box{width:min(1440px,97vw);height:min(940px,95vh);background:#fff;color:#111827;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden}',
    '.eqr-tr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:14px 18px 10px;border-bottom:1px solid #e5e7eb}',
    '.eqr-tr-head h2{margin:0;font-size:17px}.eqr-tr-head p{margin:2px 0 0;color:#4b5563}.eqr-tr-acts{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '.eqr-tr-acts a{text-decoration:none;display:inline-block}',
    '.eqr-tr-broke{margin:10px 18px 0;padding:8px 12px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:8px;font:inherit;font-weight:700;text-align:left;cursor:pointer}',
    '.eqr-tr-ok{margin:10px 18px 0;padding:8px 12px;border:1px solid #bbf7d0;background:#f0fdf4;color:#166534;border-radius:8px;font-weight:600}',
    '.eqr-tr-body{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:0}',
    '.eqr-tr-left{display:flex;flex-direction:column;min-height:0;border-right:1px solid #e5e7eb}',
    '.eqr-tr-left video{width:100%;max-height:46%;background:#0f172a;flex:0 0 auto}',
    '.eqr-tr-detail{flex:1;min-height:0;overflow:auto;padding:12px 16px}.eqr-tr-detail h4{margin:12px 0 4px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#6b7280}',
    '.eqr-tr-detail pre{margin:0;padding:8px 10px;background:#0f172a;color:#e2e8f0;border-radius:6px;font:12px/1.45 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:360px;overflow:auto}',
    '.eqr-tr-dhead{font-weight:700;word-break:break-all}.eqr-tr-dacts{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.eqr-tr-dacts button{font-size:12px;padding:4px 10px}',
    '.eqr-tr-hdrs{font:12px/1.4 ui-monospace,Consolas,monospace;color:#374151;word-break:break-all;margin:0 0 6px}.eqr-tr-hdrs summary{cursor:pointer;font:600 12px system-ui,Segoe UI,sans-serif;color:#4b5563}.eqr-tr-detail img{max-width:100%;border:1px solid #e5e7eb;border-radius:6px}',
    '.eqr-tr-right{display:flex;flex-direction:column;min-height:0}',
    '.eqr-tr-tools{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:10px 12px;border-bottom:1px solid #e5e7eb}',
    '.eqr-tr-chip{border:1px solid #d1d5db;background:#fff;border-radius:999px;padding:3px 10px;font:inherit;font-size:12px;cursor:pointer}.eqr-tr-chip[aria-pressed=true]{background:#1f2937;color:#fff;border-color:#1f2937}',
    '.eqr-tr-tools input{flex:1 1 160px;min-width:120px;border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;font:inherit}',
    '.eqr-tr-list{flex:1;min-height:0;overflow:auto}',
    '.eqr-tr-row{display:grid;grid-template-columns:52px 62px minmax(0,1fr) 46px 58px;gap:8px;align-items:center;width:100%;padding:6px 12px;border:0;border-bottom:1px solid #f1f5f9;background:#fff;font:inherit;text-align:left;cursor:pointer;color:inherit}',
    '.eqr-tr-row:hover{background:#f8fafc}.eqr-tr-row--bad{background:#fef2f2}.eqr-tr-row--bad:hover{background:#fee2e2}',
    '.eqr-tr-row--now{box-shadow:inset 3px 0 0 #2563eb}.eqr-tr-row[aria-selected=true]{background:#dbeafe}',
    '.eqr-tr-at{font:12px ui-monospace,Consolas,monospace;color:#2563eb}.eqr-tr-tag{font-size:11px;font-weight:800;color:#374151}',
    '.eqr-tr-main{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.eqr-tr-st{font-weight:800;font-size:12px}.eqr-tr-st--bad{color:#b91c1c}.eqr-tr-st--ok{color:#15803d}',
    '.eqr-tr-ms{font-size:11px;color:#6b7280;text-align:right}.eqr-tr-none{padding:16px;color:#6b7280}',
    '@media (max-width:900px){.eqr-tr-body{grid-template-columns:1fr;overflow:auto}.eqr-tr-left{border-right:0}.eqr-tr-left video{max-height:240px}}'
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
      var traceLabel = el('label', { title: 'Every web service call EquipRite makes while you test (with the JSON sent and answered), console errors and the pages you open, kept with the video. Passwords and tokens are left out.' });
      var tr = el('input', { type: 'checkbox', id: 'eqrRecTrace' });
      tr.checked = true;
      traceLabel.appendChild(tr);
      traceLabel.appendChild(document.createTextNode(' Keep the technical trace (web service calls, JSON, errors)'));
      var opts = el('div', { class: 'eqr-rec-opts' });
      opts.appendChild(minLabel);
      opts.appendChild(traceLabel);
      if (mode !== 'shot') row.appendChild(opts); else row.appendChild(el('span', {}));
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
      go.addEventListener('click', function () { done({ id: chosen, minimize: min.checked, trace: tr.checked }); });
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
    var calls = el('span', { class: 'eqr-rec-calls', id: 'eqrRecCalls', title: 'Web service calls kept in the technical trace so far' }, rec.trace ? '0 calls' : '');
    if (!rec.trace) calls.hidden = true;
    b.appendChild(calls);
    var shotB = el('button', { type: 'button', class: 'eqr-rec-shot', id: 'eqrRecShot', title: 'Screenshot (' + rec.keys.shot + ')' }, '📷 Screenshot');
    var stopB = el('button', { type: 'button', class: 'eqr-rec-stop', id: 'eqrRecStop', title: 'Stop and save (' + rec.keys.stop + ')' }, '■ Stop');
    shotB.addEventListener('click', function () { shot(); });
    stopB.addEventListener('click', function () { stop(); });
    b.appendChild(shotB);
    b.appendChild(stopB);
    b.appendChild(el('span', { class: 'eqr-rec-hint' }, rec.keys.shot + ' · ' + rec.keys.stop));
    document.body.appendChild(b);
    var r = rec;
    var ticks = 0;
    r.timer = setInterval(function () {
      time.textContent = clock(Math.floor((Date.now() - r.started) / 1000));
      // the technical trace so far: the calls, and any that failed, as they happen
      if (r.trace && ++ticks % 4 === 0) {
        getJson('/__rec/status?id=' + encodeURIComponent(r.id)).then(function (st) {
          if (!st || st.error || rec !== r) return;
          calls.textContent = st.calls + (st.calls === 1 ? ' call' : ' calls') + (st.failed ? ' · ⚠ ' + st.failed + ' failed' : '') + (st.errors ? ' · ⚠ ' + st.errors + (st.errors === 1 ? ' error' : ' errors') : '');
          calls.className = 'eqr-rec-calls' + (st.failed || st.errors ? ' eqr-rec-calls--bad' : '');
        });
      }
    }, 500);
    return { el: b, what: what, calls: calls };
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
    var j = await post('/__rec/start?key=' + encodeURIComponent(key) + '&ext=' + ext + '&trace=' + (choice.trace ? '1' : '0'));
    var recorder = new MediaRecorder(s, mime ? { mimeType: mime, videoBitsPerSecond: 2500000 } : {});
    rec = { key: key, id: j.id, name: j.name, stream: s, recorder: recorder, video: videoOf(s), queue: Promise.resolve(), started: Date.now(), shots: 0,
      keys: { shot: 'Ctrl+Alt+S', stop: 'Ctrl+Alt+X' }, error: '', trace: !!j.trace };
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

  // ── a recording's technical trace: the video in step with what happened underneath ──
  var KIND_FILTERS = [['all', 'All'], ['call', 'Calls'], ['failed', 'Failed'], ['console', 'Console'], ['page', 'Pages'], ['shot', 'Screenshots']];
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function traceSummary(s) {
    if (!s) return '';
    return [plural(s.calls, 'web service call'), s.failed ? s.failed + ' failed' : '', s.errors ? plural(s.errors, 'console error') : '',
      s.pages ? plural(s.pages, 'page') : '', s.shots ? plural(s.shots, 'screenshot') : ''].filter(function (x) { return !!x; }).join(' · ');
  }
  function entryText(e) {
    if (e.kind === 'call') return (e.service ? e.service + ' ' : '') + (e.path || e.url);
    if (e.kind === 'console') return e.message;
    if (e.kind === 'page') return e.url;
    if (e.kind === 'shot') return e.name;
    return e.kind;
  }
  function entryTag(e) {
    if (e.kind === 'call') return e.method;
    if (e.kind === 'console') return e.level === 'error' ? '⚠ error' : 'warning';
    if (e.kind === 'page') return '→ page';
    if (e.kind === 'shot') return '📷';
    return e.kind;
  }
  function bad(e) { return (e.kind === 'call' && e.failed) || (e.kind === 'console' && e.level === 'error'); }
  function shellQuote(v) { return "'" + String(v).replace(/'/g, "'\\''") + "'"; }
  function curlOf(e) {
    var parts = ['curl -X ' + e.method + ' ' + shellQuote(e.url)];
    Object.keys(e.reqHeaders || {}).forEach(function (k) {
      if (/^(content-type|accept|rest-framework-version|effective-of|upsert-mode|prefer)$/i.test(k)) parts.push('-H ' + shellQuote(k + ': ' + e.reqHeaders[k]));
    });
    if (e.reqBody) parts.push('--data-raw ' + shellQuote(String(e.reqBody).replace(/\n… cut: \d+ bytes in all$/, '')));
    return parts.join(' \\\n  ') + '\n# add your login, e.g. -u user (the trace never keeps it)';
  }
  async function copyText(text, button, done) {
    var ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      var ta = el('textarea', {});
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
    }
    if (button) {
      var was = button.textContent;
      button.textContent = ok ? (done || 'Copied') : 'Could not copy';
      setTimeout(function () { button.textContent = was; }, 1600);
    }
    return ok;
  }
  function closeTrace() {
    var v = document.getElementById('eqrTrace');
    if (v) { if (v.__close) v.__close(); else v.remove(); }
  }

  /** A recording's technical trace, beside its video: the timeline follows the video, an event moves the video to it. */
  async function openTrace(key, name) {
    styleOnce();
    var base = encodeURIComponent(key) + '/' + encodeURIComponent(name);
    var tr = await getJson('/__rec/trace/' + base);
    if (!tr) throw new Error('This recording has no technical trace.');
    closeTrace();
    var opener = document.activeElement;
    var entries = tr.entries || [];
    var s = tr.summary || {};
    var veil = el('div', { class: 'eqr-tr-veil', id: 'eqrTrace', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Technical trace of ' + key });
    var box = el('div', { class: 'eqr-tr-box' });
    var head = el('div', { class: 'eqr-tr-head' });
    var titles = el('div', {});
    var when = /(\d{4}-\d{2}-\d{2}) (\d{2})-(\d{2})/.exec(name);
    titles.appendChild(el('h2', {}, 'Technical trace · ' + key + (when ? ' · ' + when[1] + ' ' + when[2] + ':' + when[3] : '')));
    titles.appendChild(el('p', { id: 'eqrTrSum' }, traceSummary(s)));
    head.appendChild(titles);
    var acts = el('div', { class: 'eqr-tr-acts' });
    var har = el('a', { class: 'eqr-rec-btn', id: 'eqrTrHar', href: '/__rec/har/' + base, download: '', title: 'The calls as a HAR file: open it in Chrome DevTools (Network, Import) or give it to a developer' }, '⬇ HAR file');
    var copy = el('button', { type: 'button', class: 'eqr-rec-btn', id: 'eqrTrCopy', title: 'What failed, what was sent and answered, the console errors: ready to paste into Jira' }, '📋 Copy bug report');
    var close = el('button', { type: 'button', class: 'eqr-rec-btn', id: 'eqrTrClose', 'aria-label': 'Close the trace' }, '✕ Close');
    acts.appendChild(har); acts.appendChild(copy); acts.appendChild(close);
    head.appendChild(acts);
    box.appendChild(head);
    var broke = null;
    if (s.first) {
      broke = el('button', { type: 'button', class: 'eqr-tr-broke', id: 'eqrTrBroke', title: 'Show it, and the video at that moment' }, '⚠ Where it broke · ' + s.first.at + ' · ' + s.first.text);
      box.appendChild(broke);
    } else {
      box.appendChild(el('div', { class: 'eqr-tr-ok', id: 'eqrTrOk' }, entries.length ? 'Nothing failed: every call was answered, no console errors.' : 'Nothing happened underneath while this was recorded.'));
    }
    var body = el('div', { class: 'eqr-tr-body' });
    var left = el('div', { class: 'eqr-tr-left' });
    var video = el('video', { controls: '', preload: 'metadata', id: 'eqrTrVideo', src: (tr.video && tr.video.url) || '' });
    var detail = el('div', { class: 'eqr-tr-detail', id: 'eqrTrDetail', 'aria-live': 'polite' });
    detail.appendChild(el('p', { class: 'eqr-tr-none' }, 'Pick an event to see what was sent and answered; the video moves to that moment.'));
    left.appendChild(video); left.appendChild(detail);
    var right = el('div', { class: 'eqr-tr-right' });
    var tools = el('div', { class: 'eqr-tr-tools' });
    var filter = 'all';
    var counts = { all: entries.length };
    entries.forEach(function (e) { counts[e.kind] = (counts[e.kind] || 0) + 1; if (bad(e)) counts.failed = (counts.failed || 0) + 1; });
    var chips = KIND_FILTERS.filter(function (f) { return f[0] === 'all' || counts[f[0]]; }).map(function (f) {
      var c = el('button', { type: 'button', class: 'eqr-tr-chip', 'data-filter': f[0], 'aria-pressed': f[0] === 'all' ? 'true' : 'false' }, f[1] + ' ' + (counts[f[0]] || 0));
      tools.appendChild(c);
      return c;
    });
    var search = el('input', { type: 'search', id: 'eqrTrSearch', placeholder: 'Find in URLs, JSON, errors…', 'aria-label': 'Find in the trace' });
    tools.appendChild(search);
    var list = el('div', { class: 'eqr-tr-list', id: 'eqrTrList', role: 'listbox', 'aria-label': 'What happened, in order' });
    right.appendChild(tools); right.appendChild(list);
    body.appendChild(left); body.appendChild(right);
    box.appendChild(body);
    veil.appendChild(box);

    var rows = entries.map(function (e, i) {
      var r = el('button', { type: 'button', class: 'eqr-tr-row' + (bad(e) ? ' eqr-tr-row--bad' : ''), role: 'option', 'aria-selected': 'false', 'data-i': String(i), 'data-kind': e.kind });
      r.appendChild(el('span', { class: 'eqr-tr-at' }, clockMs(e.offset)));
      r.appendChild(el('span', { class: 'eqr-tr-tag' }, entryTag(e)));
      r.appendChild(el('span', { class: 'eqr-tr-main', title: entryText(e) }, entryText(e)));
      r.appendChild(el('span', { class: 'eqr-tr-st ' + (e.kind === 'call' ? (e.failed ? 'eqr-tr-st--bad' : 'eqr-tr-st--ok') : '') }, e.kind === 'call' ? String(e.status || '—') : ''));
      r.appendChild(el('span', { class: 'eqr-tr-ms' }, e.kind === 'call' ? e.ms + ' ms' : ''));
      r.__text = JSON.stringify(e).toLowerCase();
      list.appendChild(r);
      return r;
    });
    if (!rows.length) list.appendChild(el('p', { class: 'eqr-tr-none' }, 'No calls or errors were kept for this recording.'));

    function pre(text) { return el('pre', {}, text || '(nothing)'); }
    function headersBlock(h) {
      var keys = Object.keys(h || {});
      var det = el('details', { class: 'eqr-tr-hdrs' });
      det.appendChild(el('summary', {}, 'Headers (' + keys.length + ')'));
      var d = el('div', {});
      d.textContent = keys.length ? keys.map(function (k) { return k + ': ' + h[k]; }).join('\n') : '(none kept)';
      d.style.whiteSpace = 'pre-wrap';
      det.appendChild(d);
      return det;
    }
    function show(i, seek) {
      var e = entries[i];
      if (!e) return;
      rows.forEach(function (r) { r.setAttribute('aria-selected', r === rows[i] ? 'true' : 'false'); });
      rows[i].scrollIntoView({ block: 'nearest' });
      detail.innerHTML = '';
      if (e.kind === 'call') {
        detail.appendChild(el('div', { class: 'eqr-tr-dhead', id: 'eqrTrDHead' }, e.method + ' ' + e.url + ' → ' + (e.status || 'no answer') + (e.error ? ' (' + e.error + ')' : '') + ' · ' + e.ms + ' ms' + (e.app ? ' · ' + e.app : '')));
        var da = el('div', { class: 'eqr-tr-dacts' });
        var cReq = el('button', { type: 'button', class: 'eqr-rec-btn', id: 'eqrTrCopyReq' }, 'Copy what was sent');
        var cRes = el('button', { type: 'button', class: 'eqr-rec-btn', id: 'eqrTrCopyRes' }, 'Copy the answer');
        var cCurl = el('button', { type: 'button', class: 'eqr-rec-btn', id: 'eqrTrCurl', title: 'The same call as a cURL command, to repeat it outside EquipRite' }, 'Copy as cURL');
        cReq.addEventListener('click', function () { copyText(e.reqBody || '', cReq); });
        cRes.addEventListener('click', function () { copyText(e.resBody || '', cRes); });
        cCurl.addEventListener('click', function () { copyText(curlOf(e), cCurl); });
        da.appendChild(cReq); da.appendChild(cRes); da.appendChild(cCurl);
        detail.appendChild(da);
        detail.appendChild(el('h4', {}, 'Sent'));
        detail.appendChild(headersBlock(e.reqHeaders));
        if (e.reqBody) detail.appendChild(pre(e.reqBody));
        detail.appendChild(el('h4', {}, 'Answer ' + (e.status || '')));
        detail.appendChild(headersBlock(e.resHeaders));
        var ans = pre(e.resBody);
        ans.id = 'eqrTrAnswer';
        detail.appendChild(ans);
      } else if (e.kind === 'console') {
        detail.appendChild(el('div', { class: 'eqr-tr-dhead' }, 'Console ' + e.level + (e.page ? ' on ' + e.page : '')));
        detail.appendChild(pre(e.message));
        if (e.source) detail.appendChild(el('p', {}, 'From ' + e.source + (e.line ? ', line ' + e.line : '')));
      } else if (e.kind === 'page') {
        detail.appendChild(el('div', { class: 'eqr-tr-dhead' }, 'Moved to ' + e.url));
      } else if (e.kind === 'shot') {
        detail.appendChild(el('div', { class: 'eqr-tr-dhead' }, 'Screenshot ' + e.name));
        if (e.url) detail.appendChild(el('img', { src: e.url, alt: e.name }));
      }
      if (seek && video.readyState >= 1) { try { video.currentTime = (e.offset || 0) / 1000; } catch (err) { /* not seekable yet */ } }
      else if (seek) video.addEventListener('loadedmetadata', function () { try { video.currentTime = (e.offset || 0) / 1000; } catch (err) { /* no */ } }, { once: true });
    }
    function apply() {
      var q = search.value.trim().toLowerCase();
      rows.forEach(function (r, i) {
        var e = entries[i];
        var okKind = filter === 'all' || (filter === 'failed' ? bad(e) : e.kind === filter);
        r.hidden = !(okKind && (!q || r.__text.indexOf(q) !== -1));
      });
    }
    list.addEventListener('click', function (ev) {
      var r = ev.target.closest ? ev.target.closest('.eqr-tr-row') : null;
      if (r) show(Number(r.getAttribute('data-i')), true);
    });
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        filter = c.getAttribute('data-filter');
        chips.forEach(function (x) { x.setAttribute('aria-pressed', x === c ? 'true' : 'false'); });
        apply();
      });
    });
    search.addEventListener('input', apply);
    // the timeline follows the video: the event at this moment is marked
    var nowRow = null;
    video.addEventListener('timeupdate', function () {
      var t = video.currentTime * 1000;
      var at = -1;
      entries.forEach(function (e, i) { if ((e.offset || 0) <= t + 250) at = i; });
      var r = at === -1 ? null : rows[at];
      if (r === nowRow) return;
      if (nowRow) nowRow.classList.remove('eqr-tr-row--now');
      nowRow = r;
      if (r) { r.classList.add('eqr-tr-row--now'); if (!video.paused) r.scrollIntoView({ block: 'nearest' }); }
    });
    if (broke) {
      broke.addEventListener('click', function () {
        var i = -1;
        entries.forEach(function (e, k) { if (i === -1 && e.kind === s.first.kind && (e.offset || 0) === s.first.offset && bad(e)) i = k; });
        if (i !== -1) show(i, true);
      });
    }
    copy.addEventListener('click', async function () {
      var txt = '';
      try { var r = await fetch('/__rec/report/' + base, { credentials: 'same-origin', cache: 'no-store' }); txt = r.ok ? await r.text() : ''; } catch (e) { txt = ''; }
      if (txt) copyText(txt, copy, 'Copied: paste it into Jira');
    });
    var done = function () {
      document.removeEventListener('keydown', esc, true);
      try { video.pause(); } catch (e) { /* gone */ }
      veil.remove();
      if (opener && opener.isConnected && opener.focus) { try { opener.focus({ preventScroll: true }); } catch (e) { /* no */ } }
    };
    var esc = function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); done(); } };
    veil.__close = done;
    document.addEventListener('keydown', esc, true);
    close.addEventListener('click', done);
    document.body.appendChild(veil);
    close.focus();
    return { entries: entries.length, summary: s };
  }
  function clockMs(ms) { return clock(Math.floor((ms || 0) / 1000)); }

  return { available: available, list: list, reveal: reveal, begin: begin, shot: shot, stop: stop, onChange: onChange, state: state, keepFocus: keepFocus,
    openTrace: openTrace, closeTrace: closeTrace, traceSummary: traceSummary, CHUNK_MS: CHUNK_MS };
});
