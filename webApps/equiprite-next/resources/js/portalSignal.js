define([], function () {
  'use strict';

  // The customer portal's home keeps what it read. A change made in another of the portal's tabs (a delivery accepted
  // or refused, a return started, a draft deleted, a request sent or saved) tells it to read again, so the home never
  // shows a step already done. One listener: the portal page (the last one registered); none, nothing happens.
  var listener = null;

  return {
    /** The portal page: fn() is called after a change. */
    listen: function (fn) { listener = typeof fn === 'function' ? fn : null; },
    /** A tab of the portal changed something. */
    changed: function () {
      if (!listener) return;
      try { listener(); } catch (e) { /* the portal's tab is gone */ }
    }
  };
});
