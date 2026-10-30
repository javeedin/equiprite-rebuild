define([], function () {
  'use strict';

  // The line from a tab's screen to the mobile shell. Screens are inside the shell's switcher and cannot reach it
  // directly: the shell registers itself; requests made before it has are queued.
  //
  //   bus.go('approve')                         show a tab
  //   bus.focus('track', { id, number })        show a tab on one thing (a request); the tab reads it with takeFocus
  //   bus.toast('Approved REQ-123', 'info')     a toast over the tab bar
  //   bus.badge('approve', 3)                   the count on a tab's icon
  var handler = null;
  var queue = [];
  var focusFns = {};
  var waiting = {};

  function send(req) {
    if (handler) handler(req);
    else queue.push(req);
  }

  return {
    /** The shell: fn(request) receives { action: 'go' | 'toast' | 'badge', … }. */
    register: function (fn) {
      handler = fn;
      queue.splice(0).forEach(function (r) { fn(r); });
    },
    go: function (tabId) { send({ action: 'go', tab: tabId }); },
    toast: function (message, tone) { send({ action: 'toast', message: String(message || ''), tone: tone || 'info' }); },
    badge: function (tabId, count) { send({ action: 'badge', tab: tabId, count: Number(count) || 0 }); },
    /** Shows a tab on one thing; the tab's screen takes it (takeFocus) at once if open (onFocus), else once loaded. */
    focus: function (tabId, what) {
      waiting[tabId] = what || {};
      send({ action: 'go', tab: tabId });
      if (focusFns[tabId]) {
        try { focusFns[tabId](); } catch (e) { /* the next screen takes it once loaded */ }
      }
    },
    onFocus: function (tabId, fn) { focusFns[tabId] = fn; },
    takeFocus: function (tabId) {
      var w = waiting[tabId] || null;
      delete waiting[tabId];
      return w;
    }
  };
});
