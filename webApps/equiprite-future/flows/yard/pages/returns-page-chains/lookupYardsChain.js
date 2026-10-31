define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/yardLoad',
  'resources/js/yardWork',
], (ActionChain, Actions, yardLoad, yw) => {
  'use strict';

  // The yard each piece goes back to (the yard recorded when it went out: views/line-detail-units per line, New's rule
  // in yardWork.yardOfUnits), a few at a time, urgent sections first. Reads only.
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
