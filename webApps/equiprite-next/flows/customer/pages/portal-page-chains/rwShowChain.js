define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood view's Requests list is being shown (the Requests view opened under Redwood, or Redwood chosen in your
  // menu while it is open): its Smart Search is what filters it, so its criterion is applied (rwFilterChain). Oracle's
  // criterion is read only and cannot be set to match the page; nothing picked there means every request. Under Current,
  // nothing happens.
  class rwShowChain extends ActionChain {
    async run(context, params) {
      const v = context.$page.variables;
      const l = (params && params.look) || context.$application.variables.look;
      if (l !== 'redwood' || v.view !== 'requests') return;
      await Actions.callChain(context, { chain: 'rwFilterChain' });
    }
  }

  return rwShowChain;
});
