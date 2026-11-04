define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/portalRedwood',
], (ActionChain, Actions, R) => {
  'use strict';

  // The Redwood view's Smart Search (the Requests view): what was typed becomes the page's own search, Show its chip
  // (Needs you, Open, Finished, All), so both looks filter alike; the column filters (rwCols) narrow the Redwood rows only
  // (applyChain). Smart Search applies a picked filter when its list closes, as in Old.
  class rwFilterChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const c = R.readCriterion(v.rwCriterion);
      v.reqText = c.text;
      v.reqGroup = c.group;
      v.rwCols = c.cols;
      v.limit = 50;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return rwFilterChain;
});
