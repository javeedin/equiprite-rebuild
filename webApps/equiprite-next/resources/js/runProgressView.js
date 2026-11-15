define([], function () {
  'use strict';

  // Building and running your workspace's app, step by step (the desktop app's progress: /__vbs/run/progress) — what
  // Build.Rite is doing: check for changes, copy the working folder, prepare the copy, build it with Oracle's VB build
  // tool, start the app's server, open its window. Each step: ✓ done, a spinner while running, ✗ failed, – not needed,
  // ○ to come — with what it did; the build tool's last lines; how long. Drawn into an element (several may show at once:
  // the top bar's, Application pages'). No `this`.
  //
  //   start(mountId, fetch() → Promise<{ body }>, every?)   stop(mountId) (draws once more, then stops)   html(progress)

  var ICON = { done: '✓', failed: '✗', skipped: '–', todo: '○' };
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function took(p) {
    var a = Date.parse(p.at), b = p.running || !p.end ? Date.now() : Date.parse(p.end);
    return isNaN(a) ? '' : Math.max(0, Math.round((b - a) / 100) / 10) + ' s';
  }
  function html(p) {
    if (!p || !p.steps || !p.steps.length) return '';
    var head = p.running ? 'working… ' + took(p) : (p.ok ? 'done in ' + took(p) + (p.text ? ' — ' + p.text : '') : 'stopped — ' + (p.text || 'it failed'));
    var rows = p.steps.map(function (s) {
      var icon = s.state === 'running' ? '<span class="nx-spin rp-spin" aria-hidden="true"></span>' : '<span aria-hidden="true">' + (ICON[s.state] || '○') + '</span>';
      return '<li class="rp-s rp-s--' + esc(s.state) + '"><span class="rp-i">' + icon + '</span><span class="rp-l">' + esc(s.label) + '</span><span class="rp-t">' + esc(s.text) + '</span></li>';
    }).join('');
    var tail = (p.tail || []).length ? '<pre class="rp-tail" aria-label="The build tool\'s last lines">' + p.tail.map(esc).join('\n') + '</pre>' : '';
    return '<div class="rp-head"><b>' + esc(p.title) + '</b> <span class="rp-took">' + esc(head) + '</span></div><ol class="rp-steps">' + rows + '</ol>' + tail;
  }

  var runs = {}; // mount → { timer, fetch }
  function draw(mount) {
    var r = runs[mount];
    if (!r) return Promise.resolve();
    return Promise.resolve(r.fetch()).then(function (res) {
      var el = null;
      try { el = document.getElementById(mount); } catch (e) { el = null; }
      if (el && res && res.body && res.body.steps) el.innerHTML = html(res.body);
    }).catch(function () { /* next time */ });
  }
  function start(mount, fetch, every) {
    stop(mount, true);
    runs[mount] = { fetch: fetch, timer: setInterval(function () { draw(mount); }, every || 400) };
    draw(mount);
  }
  function stop(mount, quiet) {
    var r = runs[mount];
    if (!r) return Promise.resolve();
    clearInterval(r.timer);
    var last = quiet ? Promise.resolve() : draw(mount);
    return last.then(function () { delete runs[mount]; });
  }

  return { start: start, stop: stop, html: html };
});
