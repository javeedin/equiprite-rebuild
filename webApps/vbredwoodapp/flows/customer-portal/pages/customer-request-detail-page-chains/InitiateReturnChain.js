define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser'
], (ActionChain, Actions, lineBody, cu) => {
  'use strict';

  // Customer initiates return on the selected lines: DEPLOYED → RETURN_INITIATED.
  // Mirrors the project-mode initiateReturnChain (same lineStatus vocabulary).
  const SOURCE_STATE = 'DEPLOYED';
  const TARGET_STATE = 'RETURN_INITIATED';
  // Header closes ONLY once every line has reached a terminal state, and only
  // CLOSED or CONSUMED counts as finished — REJECTED lines are terminal too but
  // never arrive back at the yard, so they don't block the close. An all-REJECTED
  // request is NOT closed by this rollup (hence the some() guard).
  // Initiating a return therefore no longer closes the header: RETURN_INITIATED
  // is not terminal. The close now happens on the yard-side Accept
  // (equipment-returns-page AcceptReturnLinesChain), which carries the same rollup.
  // CONSUMED is terminal too - it is the consumable's equivalent of CLOSED, since
  // nothing comes back from a consumed item.
  const CLOSE_TERMINAL_STATES = ['CLOSED', 'REJECTED', 'CONSUMED'];

  class InitiateReturnChain extends ActionChain {
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
      // DEPLOYED ONLY — returns start from a deployed line, nothing else.
      // Kept in sync with initChain's isReturnable stamp (which gates the button):
      // change one, change the other, or the button and this filter disagree.
      //
      // HISTORY — this deliberately REVERSES an earlier requirement. DELIVERED used
      // to be a second valid source state so that consumables (which settle at
      // DELIVERED and never reach DEPLOYED) could be returned; the note read
      // "consumable returns are ALWAYS permitted - there is no returns-off switch".
      // CONSEQUENCE: consumable lines can no longer be returned at all. If that
      // case comes back, restore 'DELIVERED' here AND in the isReturnable stamp in
      // initChain. Mirrors the project-side page.
      const SOURCE_STATES = [SOURCE_STATE];

      const eligible = pool.filter(l => SOURCE_STATES.indexOf(l.lineStatus) !== -1);
      const skipped = pool.length - eligible.length;

      if (eligible.length === 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Nothing to Return',
          message: 'No selected line is on site. A line can be returned from Deployed '
                 + '(rental) or Delivered (consumable).',
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
          summary: 'Return not initiated',
          message: batch.message + ' No line was changed.',
          displayMode: 'persist',
          type: 'error'
        });
        return;
      }
      const updated  = eligible.length;

      // Header close rollup: only when EVERY line on the request is terminal
      // (CLOSED / REJECTED) and at least one is actually CLOSED.
      const verifyResult = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
        uriParams: { requestId: numericId, size: 2000 }
      });

      let headerClosed = false;
      if (verifyResult.ok && verifyResult.body && Array.isArray(verifyResult.body.data)) {
        const lines = verifyResult.body.data;
        const allTerminal = lines.length > 0 &&
          lines.every(l => CLOSE_TERMINAL_STATES.indexOf(l.lineStatus) !== -1) &&
          lines.some(l => l.lineStatus === 'CLOSED' || l.lineStatus === 'CONSUMED');
        if (allTerminal) {
          const headerPatch = await Actions.callRest(context, {
            endpoint:  'eqp-v1/patchEquipmentRequest',
            uriParams: { id: numericId },
            body:      { status: 'CLOSED' }
          });
          if (headerPatch.ok) {
            headerClosed = true;
            $page.variables.formData = Object.assign({}, $page.variables.formData, { status: 'CLOSED' });
          } else {
            console.warn('[InitiateReturnChain] header CLOSED PATCH failed:', headerPatch.status);
          }
        }
      }

      let message = updated + ' line(s) return initiated.';
      if (skipped  > 0) message += ' ' + skipped + ' skipped (wrong state).';
      if (headerClosed) message += ' Request has been closed.';

      await Actions.fireNotificationEvent(context, {
        summary:     headerClosed ? 'Return Initiated — Request Closed' : 'Return Initiated',
        message:     message,
        displayMode: 'transient',
        type:        'info'
      });

      await Actions.callChain(context, {
        chain:  'initChain',
        params: { requestId: $page.variables.requestId, requestNumericId: numericId }
      }).catch(() => {});
    }
  }

  return InitiateReturnChain;
});
