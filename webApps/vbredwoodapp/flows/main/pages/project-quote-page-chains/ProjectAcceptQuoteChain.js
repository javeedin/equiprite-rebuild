define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser',
], (ActionChain, Actions, lineBody, cu) => {
  'use strict';

  // Project approver accepts the quote: header + lines QUOTE_GENERATED →
  // QUOTE_ACCEPTED. From there the request follows the existing flow unchanged.
  //
  // Mirrors customer-portal AcceptQuoteChain's status cascade, with ONE
  // deliberate omission: no Fusion sell contract is created. A project quote is
  // an internal cost estimate, not a sale — there is no external counterparty to
  // contract with — so there is no contractNumber on a project request and no
  // ProjectLOV/Contracts call here.
  //
  // The PR divergence IS kept: a line with a purchase requisition raised is
  // being procured from a supplier, so it goes to UNDER_PROCUREMENT rather than
  // QUOTE_ACCEPTED. The header lands on QUOTE_ACCEPTED either way
  // (UNDER_PROCUREMENT is a line-only status).
  //
  // Billing is NOT generated here: the schedule is materialized per line by the
  // DB trigger when a line reaches DEPLOYED, so an accepted-but-undeployed line
  // must carry no invoices.
  class ProjectAcceptQuoteChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const numericId = $page.variables.requestNumericId;

      if (!numericId) {
        console.warn('[ProjectAcceptQuoteChain] No requestNumericId — cannot accept.');
        return;
      }

      $page.variables.isAccepting = true;

      try {
        // ── 1. Header → QUOTE_ACCEPTED ──────────────────────────────────
        // Done first: if this fails there is no point cascading lines, and a
        // header stuck at QUOTE_GENERATED is a re-runnable state.
        const headerResp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/patchEquipmentRequest',
          uriParams: { id: Number(numericId) },
          body:      { status: 'QUOTE_ACCEPTED' }
        });

        if (!headerResp || !headerResp.ok) {
          const serverMsg = headerResp && headerResp.body &&
            (headerResp.body.message || JSON.stringify(headerResp.body));
          console.error('[ProjectAcceptQuoteChain] header PATCH failed:',
            headerResp && headerResp.status, headerResp && headerResp.body);
          await Actions.fireNotificationEvent(context, {
            summary:     'Accept Failed',
            message:     serverMsg
                         ? ('HTTP ' + headerResp.status + ': ' + serverMsg)
                         : 'The server rejected the quote acceptance.',
            type:        'error',
            displayMode: 'persist'
          });
          $page.variables.isAccepting = false;
          return;
        }

        $page.variables.requestStatus = 'QUOTE_ACCEPTED';

        // ── 2. Which lines already have a PR raised? ─────────────────────
        // PR mirror rows are keyed by eqrRequestLineId (a line can have >1).
        // Best-effort: on failure treat all lines as non-PR (→ QUOTE_ACCEPTED)
        // so accept never breaks on this lookup.
        const prLineIds = new Set();
        try {
          const prResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getPurchaseRequisitions',
            uriParams: { requestId: Number(numericId), size: 500 }
          });
          if (prResp && prResp.ok && prResp.body && Array.isArray(prResp.body.data)) {
            prResp.body.data.forEach(function (m) {
              if (m && m.eqrRequestLineId != null) prLineIds.add(Number(m.eqrRequestLineId));
            });
          } else {
            console.warn('[ProjectAcceptQuoteChain] PR mirror fetch not ok — treating all lines as non-PR');
          }
        } catch (ePr) {
          console.warn('[ProjectAcceptQuoteChain] PR mirror fetch failed — treating all lines as non-PR:', ePr);
        }

        // ── 3. Cascade lines ────────────────────────────────────────────
        // Advance the pre-active lines and skip anything already downstream
        // (ALLOCATED, SHIPPED, …). QUOTE_ACCEPTED is included in CASCADABLE so a
        // re-run is idempotent for the non-PR lines.
        const CASCADABLE = [null, '', 'SUBMITTED', 'IN_PROCESS', 'QUOTE_GENERATED', 'QUOTE_ACCEPTED'];
        let lineFailures = 0;
        let targetCount  = 0;

        const linesResult = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
          // size: without it the endpoint returns its default 20 rows, so a
          // larger request had only its first 20 lines accepted.
          uriParams: { requestId: Number(numericId), size: 2000 }
        });

        if (linesResult && linesResult.ok && linesResult.body && Array.isArray(linesResult.body.data)) {
          const targets = linesResult.body.data.filter(function (l) {
            return CASCADABLE.indexOf(l.lineStatus) !== -1;
          });
          targetCount = targets.length;
          // ONE batch PATCH for every line (one transaction, all or nothing),
          // replacing a Promise.all of per-line PATCHes. On failure no line
          // moved, which the warning below reports as all of them.
          const batch = await lineBody.updateLines(context, Actions, {
            requestId: Number(numericId),
            headers:   cu.auditHeaders(context),
            updates:   targets.map(function (l) {
              return {
                id: Number(l.id),
                lineStatus: prLineIds.has(Number(l.id)) ? 'UNDER_PROCUREMENT' : 'QUOTE_ACCEPTED'
              };
            })
          });
          if (!batch.ok) {
            lineFailures = targetCount;
            console.warn('[ProjectAcceptQuoteChain] line cascade failed, no line changed:', batch.message);
          }
        } else {
          console.warn('[ProjectAcceptQuoteChain] could not fetch lines for status cascade');
        }

        // ── 4. Notify + return to the requests list ─────────────────────
        // Surfaced as a warning when any line lagged: the header reads accepted
        // but some lines didn't move, and that mismatch needs to be visible
        // rather than swallowed behind a success toast.
        await Actions.fireNotificationEvent(context, {
          summary:     lineFailures > 0 ? 'Quote Accepted — with issues' : 'Quote Accepted',
          message:     lineFailures > 0
                       ? ('Quote accepted, but ' + lineFailures + ' of ' + targetCount +
                          ' line(s) failed to update. Please refresh and check the line statuses.')
                       : 'The quote has been accepted and the request is moving forward.',
          type:        lineFailures > 0 ? 'warning' : 'confirmation',
          displayMode: lineFailures > 0 ? 'persist' : 'transient'
        });

        await Actions.navigateToPage(context, { page: 'equipment-requests' });
      } catch (e) {
        console.error('[ProjectAcceptQuoteChain] accept failed:', e);
        await Actions.fireNotificationEvent(context, {
          summary:     'Accept Failed',
          message:     'Could not accept the quote. Please try again or contact support.',
          type:        'error',
          displayMode: 'persist'
        });
      } finally {
        // Never leave the overlay stuck on "Accepting…".
        $page.variables.isAccepting = false;
      }
    }
  }

  return ProjectAcceptQuoteChain;
});
