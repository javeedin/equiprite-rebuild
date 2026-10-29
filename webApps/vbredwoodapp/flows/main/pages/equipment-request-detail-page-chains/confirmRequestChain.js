define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser'
], (ActionChain, Actions, lineBody, cu) => {
  'use strict';

  // Approve — PER LINE, with a header rollup.
  //
  // Approving acts on the SELECTED lines (falling back to all lines when nothing
  // is ticked), exactly like Reject and the other line actions on this page. The
  // request header is only walked SUBMITTED → IN_PROCESS once every line on the
  // request has settled into HEADER_READY_STATES — i.e. nothing is still waiting
  // on an approval decision. Approving a subset leaves the header at SUBMITTED so
  // the remaining lines can still be approved or rejected afterwards.
  //
  // Order matters: lines are patched FIRST and the header only after, because the
  // header decision is a function of the resulting line states. The previous
  // version flipped the header up front and cascaded afterwards, which made the
  // banner read IN_PROCESS even when most lines had not moved.
  const TARGET_STATE = 'IN_PROCESS';

  // Line states that no longer block the header from advancing. A line is either
  // approved (IN_PROCESS, or ALLOCATED when it was already fully allocated) or
  // refused (REJECTED). Anything else — notably SUBMITTED or DRAFT — is still an
  // open decision and holds the header at SUBMITTED.
  const HEADER_READY_STATES = ['IN_PROCESS', 'ALLOCATED', 'REJECTED'];

  const isHeaderReady = (s) =>
    HEADER_READY_STATES.indexOf(String(s || '').toUpperCase()) !== -1;

  class confirmRequestChain extends ActionChain {
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

      // ── Which lines are we approving? ────────────────────────────────────
      // Same selection contract as rejectRequestChain and the other line
      // actions: an explicit grid selection wins, otherwise act on every line.
      // These refs come from initChain's views/request-detail-lines fetch
      // (size 10000, single page) so getAllLines() genuinely holds every line —
      // it is NOT subject to the 20-row default on the /lines endpoint.
      const selected = $page.functions.getSelectedLines() || [];
      const allLines = $page.functions.getAllLines() || [];
      const pool = selected.length > 0 ? selected : allLines;

      // Confirm walks lines forward only from these states. It is an ALLOW-list,
      // which is what makes REJECTED terminal: a line rejected while the request
      // was still SUBMITTED is not in this set, so approving the request leaves
      // it rejected instead of resurrecting it into IN_PROCESS/ALLOCATED. Do not
      // convert this to a deny-list — a new state added upstream must default to
      // "don't touch", not to "cascade".
      const CASCADABLE = [null, '', 'DRAFT', 'SUBMITTED', 'IN_PROCESS'];
      const targets = pool.filter(l => CASCADABLE.indexOf(l.lineStatus) !== -1);
      const skipped = pool.length - targets.length;

      if (targets.length === 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Nothing to Approve',
          message: selected.length > 0
            ? 'The selected line(s) are already approved, rejected or settled.'
            : 'No line on this request can be approved.',
          displayMode: 'transient',
          type: 'warning'
        });
        return;
      }

      // ── Allocation state, for the ALLOCATED shortcut ─────────────────────
      // A fully-allocated line skips IN_PROCESS and goes straight to ALLOCATED.
      // views/request-detail-lines does NOT carry allocationStatus (verified),
      // so it is read from the lines endpoint and joined by id. `size` is
      // honoured here now that openapi3.json declares it — the server clamps to
      // 2000, which is well above any realistic line count, and a miss simply
      // falls back to IN_PROCESS rather than corrupting anything.
      const allocById = {};
      try {
        const allocResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
          uriParams: { requestId: numericId, size: 2000 }
        });
        if (allocResult && allocResult.ok && allocResult.body &&
            Array.isArray(allocResult.body.data)) {
          allocResult.body.data.forEach(r => {
            allocById[String(r.id)] = r.allocationStatus;
          });
        } else {
          console.warn('[confirmRequestChain] allocationStatus lookup non-OK:',
                       allocResult && allocResult.status, '- defaulting to IN_PROCESS');
        }
      } catch (e) {
        console.warn('[confirmRequestChain] allocationStatus lookup failed:', e,
                     '- defaulting to IN_PROCESS');
      }

      // ── Patch the lines ──────────────────────────────────────────────────
      // Line refs carry `lineId` (stamped by initChain), NOT the `id` used by
      // the raw /lines payload — same field rejectRequestChain patches on.
      // ONE batch PATCH for every line (PATCH .../lines/batch: one transaction,
      // all or nothing), replacing a Promise.all of per-line PATCHes that the
      // browser queued six at a time (368 lines took 8.6 s; the batch ~0.7 s).
      const updates = targets.map(l => ({
        id: Number(l.lineId),
        lineStatus: (allocById[String(l.lineId)] === 'ALLOCATED') ? 'ALLOCATED' : TARGET_STATE
      }));
      const batch = await lineBody.updateLines(context, Actions, {
        requestId: numericId,
        headers:   cu.auditHeaders(context),
        updates:   updates,
        labels:    targets.map(l => l.equipmentName)
      });
      if (!batch.ok) {
        // All or nothing: no line changed, so there is nothing to roll up.
        await Actions.fireNotificationEvent(context, {
          summary: 'Approve failed',
          message: batch.message + ' No line was changed.',
          displayMode: 'persist',
          type: 'error'
        });
        return;
      }
      const approvedStates = {};
      updates.forEach(u => { approvedStates[String(u.id)] = u.lineStatus; });
      const updated = updates.length;

      // ── Header rollup ────────────────────────────────────────────────────
      // Advance the header SUBMITTED → IN_PROCESS only when EVERY line on the
      // request has settled into HEADER_READY_STATES. Approving a subset leaves
      // the header at SUBMITTED so the rest can still be actioned.
      //
      // Evaluated locally against the full line set with the just-approved
      // states folded in, rather than re-fetching — an immediate re-read races
      // the PATCHes above. Same local-rollup approach rejectRequestChain uses.
      let headerAdvanced = false;
      if (updated > 0) {
        const everyLineReady = allLines.length > 0 && allLines.every(l => {
          const effective = approvedStates[String(l.lineId)] || l.lineStatus;
          return isHeaderReady(effective);
        });

        if (everyLineReady) {
          const headerResult = await Actions.callRest(context, {
            endpoint: 'eqp-v1/patchEquipmentRequest',
            uriParams: { id: numericId },
            body: { status: TARGET_STATE }
          }).catch(e => ({ ok: false, error: e }));

          if (headerResult && headerResult.ok) {
            headerAdvanced = true;
            $page.variables.formData = Object.assign(
              {}, $page.variables.formData, { status: TARGET_STATE }
            );
          } else {
            console.warn('[confirmRequestChain] header PATCH failed:',
                         headerResult && headerResult.status);
          }
        }
      }

      let message = updated + ' line(s) approved.';
      if (skipped > 0)      message += ' ' + skipped + ' skipped (already settled).';
      message += headerAdvanced
        ? ' All lines are decided, so the request moved to In Process.'
        : ' The request stays Submitted until every line is approved or rejected.';

      await Actions.fireNotificationEvent(context, {
        summary: headerAdvanced ? 'Request Approved' : 'Line(s) Approved',
        message: message,
        displayMode: 'transient',
        type: 'confirmation'
      });

      // ── Refresh in place — no browser reload ────────────────────────────
      // Was `window.location.reload()`, purely to get the cascaded lineStatus
      // values back from the server. Calling initChain directly does exactly
      // that: one enriched fetch (views/request-detail-lines) that rebuilds the
      // header formData and the grid, reassigning every variable wholesale.
      // Same data, no white flash, no re-download of the whole app.
      //
      // The optimistic formData.status set by the rollup (only when the header
      // actually advanced) stays — it makes the header flip instantly; initChain
      // then overwrites it with the server's value, so a failed cascade can't
      // leave the banner lying. When the header did NOT advance, formData was
      // never touched, so the banner correctly stays on Submitted.
      await Actions.callChain(context, {
        chain: 'initChain',
        params: {
          requestId:        $page.variables.requestId,
          requestNumericId: numericId
        }
      });

      // Approve is gated on selectionState.count, and the lines it acted on have
      // just changed status, so the stale selection must go with it. The page
      // module's own _selectedRows Set is cleared by initGridData() inside
      // initChain; these two page variables are not.
      $page.variables.selectionState = {
        count: 0, sharedStatus: '', isMixed: false, wasMixed: false,
        allSelected: false,
        allDeployed: false, allReturnable: false, allShipToSite: false
      };
      $page.variables.selectionTick = ($page.variables.selectionTick || 0) + 1;
    }
  }

  return confirmRequestChain;
});
