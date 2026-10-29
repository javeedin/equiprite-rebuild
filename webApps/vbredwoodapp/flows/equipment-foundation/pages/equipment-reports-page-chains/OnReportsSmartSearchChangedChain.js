define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/reportsData',
  'resources/js/reportCriterion',
], (ActionChain, Actions, reportsData, reportCriterion) => {
  'use strict';

  // Coalesce keystrokes into one request. The smart-search fires
  // filter-criterion-changed per keystroke; without this, typing "excavator"
  // would issue nine server round-trips and the last one to return — not the
  // last one sent — could win and paint stale rows.
  const DEBOUNCE_MS = 300;

  let timer = null;
  let seq = 0;

  class OnReportsSmartSearchChangedChain extends ActionChain {
    /**
     * Fires on smart-search filter-criterion-changed.
     *
     * The criterion is translated to params scoped to the ACTIVE tab's endpoint
     * only (reportCriterion drops fields that endpoint doesn't support), then
     * that one endpoint is refetched. Filtering is server-side; the old
     * client-side _filterRows path is gone.
     */
    async run(context, { criterion }) {
      const { $page } = context;

      const value = criterion !== undefined ? criterion : null;
      $page.variables.reportsFilterCriterion = value;

      const tab = $page.variables.reportsActiveTab;
      const meta = reportsData.TAB_META[tab];
      if (!meta) return;

      // If the change produces the same params for THIS endpoint, there is
      // nothing new to ask the server — e.g. a chip this tab doesn't support.
      const sig = reportCriterion.signature(meta.criterionKey, value);
      if (sig === $page.variables.reportsLastQuerySignature) return;
      $page.variables.reportsLastQuerySignature = sig;

      if (timer) clearTimeout(timer);
      const mySeq = ++seq;

      await new Promise((resolve) => {
        timer = setTimeout(resolve, DEBOUNCE_MS);
      });

      // A newer keystroke started while this one waited — drop this response so
      // an out-of-order reply can't overwrite fresher rows.
      if (mySeq !== seq) return;

      $page.variables.reportsIsLoading = true;
      try {
        await reportsData.loadTab($page, context, Actions, tab, value);
        // Bump the version so the grid provider's cache key changes and the
        // grid re-renders even when the new row count happens to match.
        $page.variables.reportsFilterVersion = ($page.variables.reportsFilterVersion || 0) + 1;
      } finally {
        if (mySeq === seq) $page.variables.reportsIsLoading = false;
      }
    }
  }

  return OnReportsSmartSearchChangedChain;
});
