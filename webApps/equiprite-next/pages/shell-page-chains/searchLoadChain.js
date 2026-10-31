define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/nav',
  'resources/js/globalSearch',
  'resources/js/searchData',
], (ActionChain, Actions, nav, gs, data) => {
  'use strict';

  // Reads, in the background, what the global search looks in for this role (searchData.js: requests, the fleet,
  // transfers; only what the role may open), unless it is fresh. As each part arrives an open list is worked out
  // again, so the matches fill in while typing goes on; a part that fails is left out and the list's foot says so.
  class searchLoadChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $application.variables;
      const pv = $page.variables;
      if (!v.pageAccessLoaded) return;
      const groups = nav.visibleGroups(v.pageAccessMap, v.pageAccessLoaded, v.featureFlags, v.flagsLoaded, v.buRateSources);
      const want = gs.wants(gs.accessOf(groups));
      if (!data.needs(want)) return;
      const left = data.start(context, Actions, want);
      if (pv.showResults) await Actions.callChain(context, { chain: 'searchChain', params: { keep: true } });
      while (left.length) {
        const done = await Promise.race(left.map((p, i) => p.then(() => i)));
        left.splice(done, 1);
        if (pv.showResults) await Actions.callChain(context, { chain: 'searchChain', params: { keep: true } });
      }
    }
  }

  return searchLoadChain;
});
