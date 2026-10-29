define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser'
], (ActionChain, Actions, lineBody, cu) => {
  'use strict';

  const SOURCE_STATE = 'SHIP_TO_SITE';

  // Rejecting a DELIVERY starts a RETURN — it does not reject the line.
  //
  // This button only appears once the header is confirmed and only enables for
  // SHIP_TO_SITE lines, i.e. the equipment has already left the yard and is in
  // transit. At that point "reject" means the site is refusing the delivery, and
  // the only way to act on that is to bring the equipment back. Writing REJECTED
  // (as this did) parked a physically-shipped line in a TERMINAL state with no
  // return leg: the stock was out in the field but the request considered it
  // finished, so nothing would ever generate the inbound Transfer Order.
  //
  // RETURN_INITIATED is the same state the requestor-side Initiate Return
  // produces, so a refused delivery rejoins the normal return flow and the
  // manager's Process Return creates the inbound TO from there.
  //
  // NOTE this is a different action from the SUBMITTED-stage Reject button
  // (rejectRequestChain), which genuinely rejects lines that have not shipped.
  // The two are separate buttons at different header statuses; only this one
  // deals with equipment already in transit.
  const TARGET_STATE = 'RETURN_INITIATED';

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
          summary: 'Refusal failed',
          message: batch.message + ' No line was changed.',
          displayMode: 'persist',
          type: 'error'
        });
        return;
      }
      const updated = eligible.length;

      // "return initiated", not "rejected" — the line is not finished, the
      // equipment is on its way back and still needs Process Return.
      let message = updated + ' line(s) refused — return initiated.';
      if (skipped > 0) message += ' ' + skipped + ' skipped (wrong state).';

      await Actions.fireNotificationEvent(context, {
        summary: 'Delivery Refused — Return Initiated',
        message: message,
        displayMode: 'transient',
        type: 'info'
      });

      await Actions.callChain(context, {
        chain: 'initChain',
        params: { requestId: $page.variables.requestId, requestNumericId: numericId }
      }).catch(() => {});
    }
  }

  return rejectDeliveryChain;
});
