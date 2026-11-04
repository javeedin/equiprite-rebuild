define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/portalRedwood',
], (ActionChain, Actions, R) => {
  'use strict';

  // The Redwood view's Smart Search (the Requests view): what was typed becomes the page's own search, so both looks
  // search alike; Show (Needs you, Open, Finished, All; rwGroup) and the column filters (rwCols) narrow the Redwood rows
  // only (applyChain), so the current look keeps its own Show. Smart Search applies a picked filter when its list closes, as in Old.
  class rwFilterChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const c = R.readCriterion(v.rwCriterion);
      v.reqText = c.text;
      v.rwGroup = c.group;
      v.rwCols = c.cols;
      v.limit = 50;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return rwFilterChain;
});
