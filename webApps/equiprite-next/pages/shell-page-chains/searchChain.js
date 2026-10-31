define([
  'vb/action/actionChain',
  'resources/js/nav',
  'resources/js/globalSearch',
  'resources/js/searchData',
], (ActionChain, nav, gs, data) => {
  'use strict';

  // The toolbar search's matches for what is typed (resources/js/globalSearch.js): the screens this role may open and,
  // once read (resources/js/searchData.js), the requests, equipment, units, transfers and yards it may see, grouped,
  // best first, within the scope chosen (Everything | Screens | Requests | Equipment). The index is built once per
  // load and kept while the data and the role's access stay the same.
  //   keep   true: the row chosen stays chosen when it is still there (data arriving while the list is open)
  let memo = { key: '', idx: null };

  class searchChain extends ActionChain {
    async run(context, { keep }) {
      const { $page, $application } = context;
      const v = $application.variables;
      const pv = $page.variables;
      const q = pv.query || '';
      const search = pv.search || {};
      const before = pv.results || [];
      const chosen = keep ? (before.filter((r) => r.n === pv.resultIndex && r.type !== 'head')[0] || {}).key : '';
      const groups = nav.visibleGroups(v.pageAccessMap, v.pageAccessLoaded, v.featureFlags, v.flagsLoaded, v.buRateSources);
      const access = gs.accessOf(groups);
      const snap = data.snapshot();
      const key = snap.version + '|' + gs.accessKey(access);
      if (memo.key !== key) memo = { key, idx: gs.index(snap, access, Date.now()) };
      const res = gs.search(memo.idx, q, { scope: search.scope || 'all', expanded: search.expanded || '', screens: nav.search(q, groups), access });
      let index = 0;
      if (chosen) {
        const hit = res.rows.filter((r) => r.key === chosen && r.n !== undefined)[0];
        if (hit) index = hit.n;
      }
      pv.results = res.rows;
      pv.resultIndex = index;
      pv.search = Object.assign({}, search, {
        scope: res.scope, scopes: res.scopes, count: res.count, forQuery: q, empty: res.empty, foot: gs.foot(memo.idx, snap, access),
      });
      pv.showResults = !!q.trim();
    }
  }

  return searchChain;
});
