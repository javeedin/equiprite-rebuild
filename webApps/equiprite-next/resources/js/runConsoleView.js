define([], function () {
  'use strict';

  // The Run console's log (flows/insights run-console): the lines the desktop app keeps (desktop/lib/runConsole.js, read
  // from /__vbs/console?after=<last>), drawn into one element as they come — appended, not bound one by one, so thousands
  // of lines stay quick — and kept scrolled to the end unless you scrolled up to read. Which kinds show is CSS on the
  // element (rc-f-<kind>). No `this`.
  //
  //   start({ mount, fetch(after) → Promise<{ body: { lines, last } }>, every?, onRead?(body) })   stop()   clear()   now()
  //   lineHtml(line) → '<div class="rc-l rc-k-<kind>">…'      time(iso) → '11:42:07'

  var KEEP = 4000; // lines drawn at most (the oldest go)
  var LABEL = { build: 'build', server: 'server', app: 'app', nav: 'nav', warn: 'warn', error: 'error', info: 'info', cmd: '' };
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function time(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? '' : pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function lineHtml(l) {
    var k = LABEL.hasOwnProperty(l && l.kind) ? l.kind : 'info';
    return '<div class="rc-l rc-k-' + k + '"><span class="rc-t">' + time(l.at) + '</span><span class="rc-kind">' + LABEL[k] + '</span><span class="rc-x">' + esc(l.text) + '</span></div>';
  }

  var st = { mount: '', el: null, fetch: null, onRead: null, last: 0, timer: null, busy: false };
  function el() { if (!st.el || !st.el.isConnected) { try { st.el = document.getElementById(st.mount); } catch (e) { st.el = null; } } return st.el; }
  function atEnd(e) { return e.scrollHeight - e.scrollTop - e.clientHeight < 48; }
  function draw(lines) {
    var e = el();
    if (!e || !lines.length) return;
    var stick = atEnd(e);
    e.insertAdjacentHTML('beforeend', lines.map(lineHtml).join(''));
    while (e.childElementCount > KEEP) e.removeChild(e.firstElementChild);
    if (stick) e.scrollTop = e.scrollHeight;
  }
  function tick() {
    if (st.busy || !st.fetch) return;
    st.busy = true;
    Promise.resolve(st.fetch(st.last)).then(function (r) {
      var b = (r && r.body) || {};
      if (b.lines && b.lines.length) draw(b.lines);
      if (typeof b.last === 'number') st.last = b.last;
      if (st.onRead) { try { st.onRead(b); } catch (e) { /* the screen */ } }
    }).catch(function () { /* the desktop app busy: next time */ }).then(function () { st.busy = false; });
  }
  function start(o) {
    stop();
    st.mount = o.mount; st.el = null; st.fetch = o.fetch; st.onRead = o.onRead || null; st.last = 0;
    var e = el();
    if (e) e.innerHTML = '';
    tick();
    st.timer = setInterval(tick, o.every || 800);
  }
  function stop() { if (st.timer) clearInterval(st.timer); st.timer = null; }
  function clear() { var e = el(); if (e) e.innerHTML = ''; }
  function now() { tick(); }

  return { start: start, stop: stop, clear: clear, now: now, lineHtml: lineHtml, time: time };
});
