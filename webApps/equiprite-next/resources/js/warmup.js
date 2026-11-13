define(['require'], function (require) {
  'use strict';

  // Warm-up: the first time a screen is opened, the JET components it uses (a table, the smart search, the overview page,
  // a drawer…) are loaded and set up, and the tab waits for them — on a slow network or a busy PC, seconds. So once the
  // first screen is shown, while nothing else happens (idle time), they are loaded one by one in the background: by the
  // time a tab is opened its components are ready, and it opens at once. Nothing is shown or changed.
  //
  // The lists: the components the screens of each product import (their page.json imports). tests/next-warmup.test.js
  // checks that every component a Build.Rite screen imports is here.
  var LISTS = {
    buildrite: ['ojs/ojtable', 'oj-sp/smart-search/loader', 'oj-sp/collection-container/loader', 'oj-sp/smart-search-page/loader', 'oj-c/button',
      'oj-sp/general-overview-page/loader', 'ojs/ojinputtext', 'ojs/ojdrawerpopup', 'oj-sp/general-drawer-template/loader', 'oj-sp/messages-banner/loader', 'oj-c/input-text'],
    next: ['oj-sp/general-overview-page/loader', 'ojs/ojtable', 'oj-sp/smart-search/loader', 'oj-sp/collection-container/loader', 'oj-sp/smart-search-page/loader', 'oj-c/button',
      'ojs/ojinputtext', 'ojs/ojdrawerpopup', 'oj-sp/general-drawer-template/loader', 'oj-sp/messages-banner/loader', 'oj-c/input-text']
  };
  var started = false;
  var done = [];

  function start(product, delayMs) {
    if (started || typeof window === 'undefined') return;
    started = true;
    var list = (LISTS[product] || LISTS.next).slice();
    var idle = window.requestIdleCallback ? function (f) { window.requestIdleCallback(f, { timeout: 2000 }); } : function (f) { setTimeout(f, 120); };
    var next = function () {
      var m = list.shift();
      if (!m) return;
      try { require([m], function () { done.push(m); idle(next); }, function () { idle(next); }); } catch (e) { idle(next); }
    };
    setTimeout(function () { idle(next); }, delayMs == null ? 2500 : delayMs);
  }

  return { start: start, LISTS: LISTS, done: function () { return done.slice(); } };
});
