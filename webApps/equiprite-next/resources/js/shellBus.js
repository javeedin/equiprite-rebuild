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
  var focusFns = {};
  var focusWaiting = {};
  // Build.Rite: the build in scope (an app: vbredwoodapp, equiprite, equiprite-next, equiprite-mobile, equiprite-future;
  // '' for all), chosen in the top bar; Issues and Application pages follow it. Kept on this PC.
  var SCOPE_KEY = 'eqr.build.scope';
  var scope = (function () { try { return (typeof localStorage !== 'undefined' && localStorage.getItem(SCOPE_KEY)) || ''; } catch (e) { return ''; } }());
  var scopeFns = {};

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
    },
    /**
     * Opens a screen on one thing: bus.focus('picking', { id, number }) opens Picking & shipping with that request open.
     * The screen reads what it was handed with takeFocus: at once when its tab is already open (onFocus), else once it
     * has loaded.
     */
    focus: function (navId, what) {
      focusWaiting[navId] = what || {};
      send({ action: 'open', navId: navId });
      if (focusFns[navId]) {
        try { focusFns[navId](); } catch (e) { /* a closed tab's page: the next one takes it once loaded */ }
      }
    },
    /** A screen that can be opened on one thing: fn() runs when something is handed to it while it is open. */
    onFocus: function (navId, fn) { focusFns[navId] = fn; },
    /** The build in scope ('' for all builds). */
    scope: function () { return scope; },
    /** Chooses the build in scope: every screen that follows it is told. */
    setScope: function (app) {
      scope = String(app || '');
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(SCOPE_KEY, scope); } catch (e) { /* private mode */ }
      Object.keys(scopeFns).forEach(function (k) { try { scopeFns[k](scope); } catch (e) { /* a closed tab's page */ } });
    },
    /** A screen that follows the build in scope: fn(app) runs when it changes (one per screen: a new page replaces it). */
    onScope: function (screen, fn) { scopeFns[screen] = fn; },
    /** What was handed to a screen, once; null when nothing waits. */
    takeFocus: function (navId) {
      var w = focusWaiting[navId] || null;
      delete focusWaiting[navId];
      return w;
    }
  };
});
