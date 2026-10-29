define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/analyticsData',
], (
  ActionChain,
  Actions,
  analyticsData
) => {
  'use strict';

  // Coalesce keystrokes into one request. filter-criterion-changed fires per
  // keystroke; without this, typing "excavator" issues nine round-trips and the
  // last to RETURN — not the last sent — could win and paint stale rows.
  const DEBOUNCE_MS = 300;

  let timer = null;
  let seq = 0;

  class OnAnalyticsSmartSearchChangedChain extends ActionChain {
    /**
     * Fires on the oj-sp-smart-search filter-criterion-changed event.
     *
     * The criterion is translated into params scoped to the ACTIVE tab's endpoint
     * (analyticsData.searchParams drops fields that endpoint doesn't declare),
     * then the tab is refetched. Search is server-side — the grid providers no
     * longer filter rows client-side.
     *
     * @param {any} params.criterion JET FilterOperator criterion from event.detail.value
     */
    async run(context, { criterion }) {
      const { $page } = context;

      const value = criterion !== undefined ? criterion : null;
      $page.variables.analyticsFilterCriterion = value;

      const tab = $page.variables.analyticsActiveTab;

      // Nothing new to ask this endpoint — e.g. a chip it doesn't support.
      const sig = analyticsData.searchSignature(tab, value);
      if (sig === $page.variables.analyticsLastQuerySignature) return;
      $page.variables.analyticsLastQuerySignature = sig;

      if (timer) clearTimeout(timer);
      const mySeq = ++seq;

      await new Promise((resolve) => { timer = setTimeout(resolve, DEBOUNCE_MS); });

      // A newer keystroke started while this one waited — drop this one so an
      // out-of-order reply can't overwrite fresher rows.
      if (mySeq !== seq) return;

      // loadActiveTab reads analyticsFilterCriterion (set above) and manages
      // isLoading itself.
      await analyticsData.loadActiveTab($page, context, Actions);

      // Bump the version so each grid provider's cache key changes and the grid
      // re-renders even when the new row count matches the old.
      $page.variables.analyticsFilterVersion = ($page.variables.analyticsFilterVersion || 0) + 1;
    }
  }

  return OnAnalyticsSmartSearchChangedChain;
});
