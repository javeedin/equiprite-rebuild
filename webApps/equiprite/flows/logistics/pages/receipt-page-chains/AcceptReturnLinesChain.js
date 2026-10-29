define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser'
], (ActionChain, Actions, lineBody, cu) => {
  'use strict';

  // Accept, on the returns page, finalizes a line that has physically
  // arrived back at the yard: SHIPPED_TO_YARD -> CLOSED. Only lines already
  // in SHIPPED_TO_YARD are acceptable (the grid disables every other status);
  // the SOURCE_STATE filter below mirrors acceptDeliveryChain.js's
  // (SHIP_TO_SITE -> DEPLOYED) source-state guard. Both states' display
  // labels live in resources/js/lineStatusLabels.js.
  const SOURCE_STATE = 'SHIPPED_TO_YARD';
  const TARGET_STATE = 'CLOSED';
  // Header close rollup (mirrors initiateReturnChain / InitiateReturnChain):
  // the request header only goes CLOSED once EVERY line is terminal, and only
  // CLOSED or CONSUMED counts as finished. REJECTED lines are terminal too but never
  // come back to the yard, so they don't block the close; an all-REJECTED request is
  // NOT closed here (hence the some() guard). This is the point where the
  // last line actually reaches CLOSED, so this is where the header flips.
  // CONSUMED is terminal too - it is the consumable's equivalent of CLOSED, since
  // nothing comes back from a consumed item.
  const CLOSE_TERMINAL_STATES = ['CLOSED', 'REJECTED', 'CONSUMED'];

  class AcceptReturnLinesChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const requestId = $page.variables.selectedRequest &&
        (($page.variables.selectedRequest.eqrEquipmentRequestId) || $page.variables.selectedRequest.id);
      if (!requestId) return;

      const selected = ($page.functions.getSelectedLines && $page.functions.getSelectedLines()) || [];
      // Only SHIPPED_TO_YARD lines can be closed — defense-in-depth behind
      // the grid's disabled rows / checkboxes.
      const eligible = selected.filter(l => l && l.lineStatus === SOURCE_STATE);
      if (eligible.length === 0) return;

      // Actual return date drives the early-return re-price in Post Cost:
      // the backend binds this to EQR_REQUEST_LINE.ACTUAL_RETURN_DATE (a
      // TIMESTAMP WITH TIME ZONE → Java OffsetDateTime) and the post-cost view
      // bills LEAST(planned_end, actual_return). Default to today (the line is
      // CLOSED the day it physically arrives back).
      // MUST be a full ISO-8601 datetime with offset — a bare "YYYY-MM-DD"
      // cannot deserialize into OffsetDateTime and the PATCH 500s. Append
      // T00:00:00Z (same idiom as line-detail saveLineChain's asDay()).
      const _retDay =
        ($page.variables.actualReturnDate && String($page.variables.actualReturnDate).slice(0, 10)) ||
        new Date().toISOString().slice(0, 10);
      const actualReturnDate = _retDay + 'T00:00:00Z';

      // ONE batch PATCH for every line (one transaction, all or nothing),
      // replacing a per-line Promise.all: either every line closes or none does.
      const closeBatch = await lineBody.updateLines(context, Actions, {
        requestId: Number(requestId),
        headers:   cu.auditHeaders(context),
        updates:   eligible.map(l => ({
          id: Number(l.lineId), lineStatus: TARGET_STATE, actualReturnDate: actualReturnDate
        }))
      });
      if (!closeBatch.ok) {
        console.warn('[AcceptReturnLinesChain] close batch failed, no line changed:', closeBatch.message);
      }
      const failures = closeBatch.ok ? 0 : eligible.length;
      const updated  = eligible.length - failures;

      // ── Release the serial units back to stock ───────────────────────────
      // A closed line's equipment is physically back in the yard, so its units
      // must return to AVAILABLE or they stay RENTED forever and can never be
      // allocated again — the unit is stranded even though the request is done.
      //
      // Runs for EVERY class, not just F&M. An S&T return has a Fusion receipt
      // that settles inventory, but UNIT_STATUS on EQR_SERIAL_REF is EquipRite's
      // own column and nothing else writes it back on this path.
      //
      // ONLY for lines whose CLOSE actually succeeded — releasing a unit whose
      // line is still SHIPPED_TO_YARD would advertise equipment as free while
      // the request still holds it.
      //
      // Best-effort and non-blocking: a failed release is logged and surfaced in
      // the toast, but never undoes a completed close. The alternative (aborting
      // the accept) would leave the line un-closed over a secondary concern.
      const closedLines = closeBatch.ok ? eligible : [];
      let unitsReleased = 0;
      const unitFailures = [];

      await Promise.all(closedLines.map(async (l) => {
        let allocs = [];
        try {
          const r = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getAllocations',
            uriParams: { requestLineId: Number(l.lineId) }
          });
          allocs = (r && r.ok && r.body && Array.isArray(r.body.data)) ? r.body.data : [];
        } catch (e) {
          console.warn('[AcceptReturnLinesChain] allocations fetch failed for line', l.lineId, e);
          return;
        }

        // EVERY unit type. The allocation row states the type directly: it
        // carries exactly one of the three ref FKs, so no lookup is needed to
        // find out what kind of unit it points at - which of the three is
        // populated IS the discriminator.
        // A RELEASED allocation was already handed back, so it is skipped.
        const unitTargets = allocs
          .filter(a => a
            && String(a.allocationStatus || '').toUpperCase() !== 'RELEASED'
            && !a.releasedDate)
          .map(a => {
            if (a.eqrSerialRefId != null)     return { type: 'SERIAL', id: Number(a.eqrSerialRefId) };
            if (a.eqrLotRefId != null)        return { type: 'LOT',    id: Number(a.eqrLotRefId) };
            if (a.inventoryItemRefId != null) return { type: 'ITEM',   id: Number(a.inventoryItemRefId) };
            return null;
          })
          .filter(Boolean);

        // Dedupe on type+id, not id alone - the three id spaces are disjoint,
        // so the same number can legitimately appear as a serial and as a lot.
        const seenUnits = new Set();
        const uniqueTargets = unitTargets.filter(t => {
          const k = t.type + ':' + t.id;
          if (seenUnits.has(k)) return false;
          seenUnits.add(k);
          return true;
        });

        await Promise.all(uniqueTargets.map(async (target) => {
          try {
            // Each table has exactly ONE status column and they are not
            // interchangeable: EQR_SERIAL_REF has unitStatus, EQR_LOT_REF has
            // lotStatus, EQR_INVENTORY_ITEM_REF has itemStatus. Writing
            // unitStatus to a lot or item row targets a column that does not
            // exist there.
            // SERIAL uses AVAILABLE/RENTED; LOT and ITEM use ACTIVE.
            const spec = target.type === 'LOT'
              ? { endpoint: 'eqp-v1/patchLotRef',           body: { lotStatus:  'ACTIVE' } }
              : target.type === 'ITEM'
              ? { endpoint: 'eqp-v1/patchInventoryItemRef', body: { itemStatus: 'ACTIVE' } }
              : { endpoint: 'eqp-v1/patchSerialRef',        body: { unitStatus: 'AVAILABLE' } };
            const r2 = await Actions.callRest(context, {
              endpoint:  spec.endpoint,
              uriParams: { id: target.id },
              body:      spec.body
            });
            if (r2 && r2.ok) unitsReleased++;
            else unitFailures.push(target.id);
          } catch (e) {
            console.warn('[AcceptReturnLinesChain] unit release failed for', target.type, target.id, e);
            unitFailures.push(target.id);
          }
        }));
      }));

      // Re-read every line on the request and close the header if they have all
      // reached a terminal state. Read-back rather than reasoning from the local
      // grid: the drawer may be showing a filtered subset of the request's lines.
      let headerClosed = false;
      const verifyResult = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
        uriParams: { requestId: Number(requestId), size: 2000 }
      }).catch(e => ({ ok: false, error: e }));

      if (verifyResult.ok && verifyResult.body && Array.isArray(verifyResult.body.data)) {
        const lines = verifyResult.body.data;
        const allTerminal = lines.length > 0 &&
          lines.every(l => CLOSE_TERMINAL_STATES.indexOf(l.lineStatus) !== -1) &&
          lines.some(l => l.lineStatus === 'CLOSED' || l.lineStatus === 'CONSUMED');
        if (allTerminal) {
          const headerPatch = await Actions.callRest(context, {
            endpoint:  'eqp-v1/patchEquipmentRequest',
            uriParams: { id: Number(requestId) },
            body:      { status: 'CLOSED' }
          }).catch(e => ({ ok: false, error: e }));
          if (headerPatch.ok) {
            headerClosed = true;
          } else {
            console.warn('[AcceptReturnLinesChain] header CLOSED PATCH failed:', headerPatch.status);
          }
        }
      } else {
        console.warn('[AcceptReturnLinesChain] line read-back failed; header left unchanged.');
      }

      // Refresh the drawer the same way opening it does, so the grid
      // reflects the new lineStatus immediately.
      await Actions.callChain(context, {
        chain:  'openPickingDrawerChain',
        params: { rowData: $page.variables.selectedRequest }
      });

      // Row indices from the pre-refresh grid are now stale — clear the
      // selection gate explicitly (getLinesGridProvider also resets its own
      // internal selection Set once the refreshed lines rebuild the grid).
      $page.variables.lineSelectionState = { count: 0 };
      $page.variables.lineSelectionTick  = ($page.variables.lineSelectionTick || 0) + 1;
      // Reset the return-date picker so it doesn't carry into the next line/request.
      $page.variables.actualReturnDate = '';

      await Actions.fireNotificationEvent(context, {
        summary:     (failures > 0 || unitFailures.length) ? 'Accepted With Errors'
                                 : (headerClosed ? 'Return Closed — Request Closed' : 'Return Closed'),
        message:     updated + ' line(s) closed.' +
                     (failures > 0 ? ' ' + failures + ' failed to update.' : '') +
                     // Say so explicitly: a unit left RENTED cannot be
                     // re-allocated, and silence would hide that until someone
                     // tried to allocate it and found it missing from the list.
                     (unitsReleased ? ' ' + unitsReleased + ' unit(s) returned to stock.' : '') +
                     (unitFailures.length
                       ? ' ' + unitFailures.length + ' unit(s) could not be returned to stock —'
                         + ' they remain Rented and need manual release.'
                       : '') +
                     (headerClosed ? ' Request has been closed.' : ''),
        displayMode: (failures > 0 || unitFailures.length) ? 'persist' : 'transient',
        type:        (failures > 0 || unitFailures.length) ? 'warning' : 'confirmation'
      });
    }
  }

  return AcceptReturnLinesChain;
});
