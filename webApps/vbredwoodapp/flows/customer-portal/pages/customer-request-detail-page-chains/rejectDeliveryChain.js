define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser'
], (ActionChain, Actions, lineBody, cu) => {
  'use strict';

  // Customer rejects delivery: SHIP_TO_SITE → REJECTED.
  // Mirrors project-mode rejectDeliveryChain.
  const SOURCE_STATE = 'SHIP_TO_SITE';
  const TARGET_STATE = 'REJECTED';

  class rejectDeliveryChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const numericId = $page.variables.requestNumericId;

      if (!numericId) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Error',
          message: 'Request ID not available. Please reload the page.',
          displayMode: 'transient',
          type: 'error'
        });
        return;
      }

      const selected = $page.functions.getSelectedLines() || [];
      const pool = selected.length > 0 ? selected : ($page.functions.getAllLines() || []);
      const eligible = pool.filter(l => l.lineStatus === SOURCE_STATE);
      const skipped = pool.length - eligible.length;

      if (eligible.length === 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Nothing to Reject',
          message: 'No selected line is in Shipping to Site state.',
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }

      // ONE batch PATCH for every line (PATCH .../lines/batch: one transaction,
      // all or nothing), replacing a Promise.all of per-line PATCHes that the
      // browser queued six at a time (368 lines took 8.6 s; the batch ~0.7 s).
      const batch = await lineBody.updateLines(context, Actions, {
        requestId: numericId,
        headers:   cu.auditHeaders(context),
        updates:   eligible.map(l => ({ id: Number(l.lineId), lineStatus: TARGET_STATE })),
        labels:    eligible.map(l => l.equipmentName)
      });
      if (!batch.ok) {
        // All or nothing: no line changed, so there is nothing to roll up.
        await Actions.fireNotificationEvent(context, {
          summary: 'Rejection failed',
          message: batch.message + ' No line was changed.',
          displayMode: 'persist',
          type: 'error'
        });
        return;
      }
      const updated  = eligible.length;

      let message = updated + ' line(s) rejected.';
      if (skipped  > 0) message += ' ' + skipped + ' skipped (wrong state).';

      await Actions.fireNotificationEvent(context, {
        summary:     'Delivery Rejected',
        message:     message,
        displayMode: 'persist',
        type:        'info'
      });

      setTimeout(() => { window.location.reload(); }, 100);
    }
  }

  return rejectDeliveryChain;
});
