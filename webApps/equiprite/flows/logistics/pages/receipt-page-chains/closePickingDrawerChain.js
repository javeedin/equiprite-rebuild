define([
  'vb/action/actionChain',
  'ojs/ojkeyset',
], (ActionChain, keySet) => {
  'use strict';

  class closePickingDrawerChain extends ActionChain {
    async run(context, { event } = {}) {
      const { $page } = context;

      // GUARD (fixes accidental close): the dialog's on-oj-close fires for ANY
      // `ojClose` event that bubbles up to it — including from child oj-popups
      // like the truncated-label TOOLTIP that closes when the lines grid
      // re-renders after a selection change, and the date-picker popup. That is
      // NOT the dialog closing, so we must ignore it. Only proceed when the
      // ojClose actually came from the dialog itself (id=pickingDetailDialog).
      // Diagnosed via console-logging the ojClose target (was oj-popup label
      // tooltip). Without this, selecting a line or clicking a date tore down
      // the whole dialog.
      if (event && event.type === 'ojClose') {
        const tgt = event.target;
        const tgtId = tgt && tgt.id;
        if (tgtId !== 'pickingDetailDialog') {
          // a child popup/tooltip closed and bubbled up — ignore it.
          return;
        }
      }

      const dialog = document.getElementById('pickingDetailDialog');
      if (dialog && typeof dialog.close === 'function') dialog.close();

      $page.variables.isDrawerOpen = false;
      $page.variables.selectedRequest = { lines: [], pickingExceptions: [] };

      // Clear the table's selected row so re-clicking the SAME row counts
      // as a selection change and re-fires onRowAction — without this the
      // dialog won't reopen on a second click of the same request. Deferred
      // to the next tick so it runs after the dialog hands focus back to the
      // table; uses KeySetImpl (the JET cookbook's canonical reset).
      setTimeout(() => {
        try {
          const table = document.getElementById('equipmentReturnsTable');
          if (table) {
            table.selected = { row: new keySet.KeySetImpl(), column: new keySet.KeySetImpl() };
          }
        } catch (e) {
          console.warn('[closePickingDrawer] could not clear table selection:', e);
        }
      }, 0);
    }
  }

  return closePickingDrawerChain;
});
