define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Move the review grid to another page of fetched rows.
   *
   * NEVER IMPORTS. This used to "save pending edits first" -- and since
   * 2026-10-03 saving IS importing (PATCH + promote of the ticked rows), so
   * one class edit plus 30 ticks merged 30 rows into the equipment master on
   * a click of Next, with no Import pressed. Found in review, 2026-10-05.
   *
   * Ticks and edits belong to the rows on screen. Leaving the page with any
   * pending asks first (pendingWorkCount) and, on OK, discards them; Cancel
   * stays put with everything intact. Nothing pending = no prompt, so a pass
   * through 50 pages of untouched rows is still prompt-free.
   */
  class StagingPageChangeChain extends ActionChain {
    async run(context, { direction }) {
      const { $page } = context;

      if ($page.variables.stagingLoading || $page.functions.isBusy($page.variables)) return;

      const pageSize = $page.variables.stagingPageSize || 100;
      const current  = $page.variables.stagingPage || 0;
      const total    = $page.variables.stagingTotalElements || 0;
      const lastPage = total ? Math.max(0, Math.ceil(total / pageSize) - 1) : 0;

      const next = direction === 'PREV' ? current - 1 : current + 1;
      if (next < 0 || next > lastPage) return;

      if ($page.functions.pendingWorkCount($page.variables) > 0) {
        const ok = window.confirm(
          'Leave this page?\n\n' + $page.functions.pendingWorkText($page.variables) +
          ' on this page will be discarded. Ticks and class edits apply to the ' +
          'rows on screen — click Import first to keep them.');
        if (!ok) return;
      }

      $page.variables.stagingPage = next;
      await Actions.callChain(context, { chain: 'LoadStagingChain' });
    }
  }

  return StagingPageChangeChain;
});
