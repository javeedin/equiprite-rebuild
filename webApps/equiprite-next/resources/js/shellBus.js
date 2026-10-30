define([], function () {
  'use strict';

  // How a screen inside a tab talks to the shell around it: open a screen or a record in a tab, name its own tab,
  // show a toast. Each tab is its own flow under oj-vb-switcher, so this one module (loaded once) is the line between
  // them: the shell registers itself; requests made before it has are queued.
  //
  //   bus.open({ navId: 'requests' })
  //   bus.open({ record: 'request', params: { id: 10482, number: 'REQ-10482' } })
  //   bus.rename('request:10482', 'REQ-10482')
  //   bus.toast('3 rows copied', 'info')
  var handler = null;
  var queue = [];
  var guards = {};

  function send(req) {
    if (handler) handler(req);
    else queue.push(req);
  }

  return {
    /** The shell: fn(request) receives { action: 'open' | 'rename' | 'toast' | 'close', … }. */
    register: function (fn) {
      handler = fn;
      queue.splice(0).forEach(function (r) { fn(r); });
    },
    open: function (req) { send(Object.assign({ action: 'open' }, req || {})); },
    rename: function (id, title) { send({ action: 'rename', id: id, title: title }); },
    close: function (id) { send({ action: 'close', id: id }); },
    toast: function (message, tone) { send({ action: 'toast', message: message, tone: tone || 'info' }); },
    /** While work in a tab must not be cut off (a Fusion sync), what closing it would interrupt; null lifts it. */
    guard: function (tabId, message) {
      if (message) guards[tabId] = String(message);
      else delete guards[tabId];
    },
    /** What closing these tabs would interrupt, in words, or '' (the shell asks before closing). */
    closeWarning: function (tabIds) {
      return (tabIds || []).map(function (id) { return guards[id]; }).filter(function (m) { return !!m; }).join(' ');
    }
  };
});
