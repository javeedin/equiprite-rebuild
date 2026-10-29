define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser'
], (ActionChain, Actions, lineBody, cu) => {
  'use strict';

  // Reject — PER LINE, not per request.
  //
  // This used to PATCH the request header to REJECTED and then fan out
  // 'REJECTED' to EVERY line, ignoring the grid selection entirely. Rejecting
  // one line of a SUBMITTED request therefore killed the whole request. Now it
  // behaves like every other line action on this page (rejectDelivery,
  // acceptDelivery, initiateReturn): operate on the SELECTED lines, falling back
  // to all lines only when nothing is selected.
  //
  // The header is no longer rejected as a matter of course — the request stays
  // live so its remaining lines can carry on through the normal flow. It is only
  // set to REJECTED when the rejection leaves NOTHING outstanding (every line on
  // the request is now in a terminal state), because a request with no live
  // lines has nowhere left to go.
  //
  // REJECTED IS TERMINAL. A rejected line is never re-patched by this page:
  // TERMINAL_STATES below is the source-state guard, and the other chains use
  // the same shape (confirmRequestChain's CASCADABLE allow-list, and the
  // SOURCE_STATE filters in the accept/return chains) so none of them can walk a
  // rejected line forward again.
  const TARGET_STATE = 'REJECTED';

  // States a line can no longer move out of. Used twice: to refuse re-rejecting
  // (or un-rejecting) a settled line, and to decide whether anything is still
  // outstanding on the request after this rejection.
  const TERMINAL_STATES = ['REJECTED', 'CANCELLED', 'CLOSED', 'CONSUMED'];

  const isTerminal = (s) => TERMINAL_STATES.indexOf(String(s || '').toUpperCase()) !== -1;

  class rejectRequestChain extends ActionChain {
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

      // Same selection contract as the sibling line actions: explicit selection
      // wins, otherwise act on every line. Line refs carry `lineId` (stamped by
      // initChain) — NOT the `id` the raw /lines payload uses, which is what the
      // old whole-request version patched.
      const selected = $page.functions.getSelectedLines() || [];
      const pool = selected.length > 0 ? selected : ($page.functions.getAllLines() || []);

      // Already-terminal lines are skipped rather than re-patched, so a second
      // Reject click can't churn a settled line and a CLOSED/CONSUMED line can
      // never be dragged back to REJECTED.
      const eligible = pool.filter(l => !isTerminal(l.lineStatus));
      const skipped = pool.length - eligible.length;

      if (eligible.length === 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Nothing to Reject',
          message: selected.length > 0
            ? 'The selected line(s) are already rejected, cancelled or closed.'
            : 'No line on this request can be rejected.',
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
          summary: 'Reject failed',
          message: batch.message + ' No line was changed.',
          displayMode: 'persist',
          type: 'error'
        });
        return;
      }
      const rejectedIds = {};
      eligible.forEach(l => { rejectedIds[String(l.lineId)] = true; });
      const updated = eligible.length;

      // ── Header rollup ────────────────────────────────────────────────────
      // Only reject the REQUEST when this leaves nothing outstanding. Evaluated
      // against the full line set with the just-rejected ids folded in, rather
      // than re-fetching (an immediate re-read races the PATCHes above) — the
      // same local-rollup approach acceptDeliveryChain and the return chains use.
      let requestRejected = false;
      if (updated > 0) {
        const allLines = $page.functions.getAllLines() || [];
        const anyLive = allLines.some(l =>
          !rejectedIds[String(l.lineId)] && !isTerminal(l.lineStatus)
        );

        if (!anyLive && allLines.length > 0) {
          const headerResult = await Actions.callRest(context, {
            endpoint: 'eqp-v1/patchEquipmentRequest',
            uriParams: { id: numericId },
            body: { status: TARGET_STATE }
          }).catch(e => ({ ok: false, error: e }));

          if (headerResult && headerResult.ok) {
            requestRejected = true;
            $page.variables.formData = Object.assign(
              {}, $page.variables.formData, { status: TARGET_STATE }
            );
          } else {
            console.warn('[rejectRequestChain] header PATCH failed', headerResult && headerResult.status);
          }
        }
      }

      let message = updated + ' line(s) rejected.';
      if (skipped > 0)  message += ' ' + skipped + ' skipped (already settled).';
      if (requestRejected) message += ' No lines remain, so the request was rejected.';

      await Actions.fireNotificationEvent(context, {
        summary: requestRejected ? 'Request Rejected' : 'Line(s) Rejected',
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

  return rejectRequestChain;
});
