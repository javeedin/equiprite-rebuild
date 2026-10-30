define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/yardLoad',
  'resources/js/yardWork',
], (ActionChain, Actions, yardLoad, yw) => {
  'use strict';

  // The yard each piece still in the yard ships from: views/line-detail-units per line, a few at a time, urgent
  // sections first (the yard rule is New's, yardWork.yardOfUnits). The list fills in batch by batch. Reads only.
  class lookupYardsChain extends ActionChain {
    async run(context, { token }) {
      const v = context.$page.variables;
      const lookups = yw.yardLookups(v.items, v.yards);
      if (!lookups.length || v.loadToken !== token) return;
      const stale = () => v.loadToken !== token;
      v.yardsLoading = true;
      try {
        await yardLoad.yards(context, Actions, lookups, async (batch) => {
          if (stale()) return;
          v.yards = Object.assign({}, v.yards, batch);
          await Actions.callChain(context, { chain: 'applyChain' });
        }, stale);
      } finally {
        if (!stale()) {
          v.yardsLoading = false;
          await Actions.callChain(context, { chain: 'applyChain' });
        }
      }
    }
  }

  return lookupYardsChain;
});
