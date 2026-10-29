define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Hand the ticked rows to DirectReturnChain.
   *
   * Thin on purpose: this resolves the selected rowKeys back to full rows and
   * delegates. The return sequence itself lives in DirectReturnChain, which
   * calls the shared resources/js/returnLeg — the same code request-detail's
   * processReturn uses, so the two legs cannot drift.
   */
  class SubmitDirectReturnChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const keys = $page.variables.directReturnSelected || [];
      const rows = ($page.variables.directReturnRows || [])
        .filter(r => keys.indexOf(r.rowKey) !== -1);

      // Guarded in the UI too (the button is disabled), but a keyboard or DOM
      // change must not get past it either.
      if (!rows.length) return;

      await Actions.callChain(context, {
        chain:  'DirectReturnChain',
        params: { rows: rows }
      });
    }
  }

  return SubmitDirectReturnChain;
});
