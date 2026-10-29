define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
  'resources/js/bryntumDates',
  'resources/js/lineDetailUnits',
  'resources/js/lineConfirmed',
], (ActionChain, Actions, _au, bryntumDates, lineDetailUnits, lineConfirmed) => {
  'use strict';

  /**
   * Fired when the Yard LOV selection changes on line-detail. Re-fetches
   * line-detail-units scoped to the chosen inventory org (yardId) — the view
   * filters the unit rows AND recomputes availability server-side — then
   * rebuilds the whole picker via initScheduler. Works for serial / lot /
   * inventory (mode comes from the page module). Clearing the yard (null)
   * re-fetches spanning all orgs.
   *
   * Standard re-scope pattern: event → chain → re-fetch → rebuild data layer
   * in place (no page navigation/reload). Resource mapping is shared with
   * vbEnterChain via resources/js/lineDetailUnits.
   *
   * Params (forwarded from the page JSON listener):
   *   yardId — the selected inventory org id (numeric), or '' / null to clear.
   */
  class RescopeYardChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;

      const requestId = $page.variables.requestId;
      const lineId    = $page.variables.lineId;
      if (!requestId || !lineId) {
        console.warn('[line-detail RescopeYardChain] Missing requestId/lineId.');
        return;
      }

      // Mode + name/class + lineData come from the page module (resolved on
      // load). Avoids re-deriving the control flags here.
      const ctx = ($page.functions && typeof $page.functions.getRebuildContext === 'function')
        ? $page.functions.getRebuildContext()
        : null;
      if (!ctx || !ctx.mode) {
        console.warn('[line-detail RescopeYardChain] No rebuild context from page module.');
        return;
      }

      const yardId = (params && params.yardId != null) ? params.yardId : $page.variables.selectedYard;

      // ── 1. Re-fetch units scoped to the yard (view filters rows + avail) ──
      const uriParams = { requestId: Number(requestId), lineId: Number(lineId), size: 10000 };
      if (yardId != null && yardId !== '' && Number(yardId) > 0) {
        uriParams.yardId = Number(yardId);
      }

      // Fetch the yard-scoped units AND the authoritative (yard-independent)
      // allocation list in parallel. The units view DROPS allocationId when
      // yardId is passed (verified), so getAllocations — keyed by requestLineId,
      // unaffected by yard — is the source of truth for what's allocated.
      let unitsResp, allocResp;
      try {
        [unitsResp, allocResp] = await Promise.all([
          Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1ViewsLineDetailUnits',
            uriParams: uriParams
          }),
          Actions.callRest(context, {
            endpoint:  'eqp-v1/getAllocations',
            uriParams: { requestLineId: Number(lineId) }
          })
        ]);
      } catch (e) {
        console.warn('[line-detail RescopeYardChain] re-fetch failed:', e);
        return;
      }
      if (!unitsResp || !unitsResp.ok || !unitsResp.body || !Array.isArray(unitsResp.body.data)) {
        console.warn('[line-detail RescopeYardChain] line-detail-units re-fetch not ok.');
        return;
      }

      // Active allocations on this line (RELEASED excluded) — the whole-line
      // truth regardless of which yard is shown.
      const activeAllocs = (allocResp && allocResp.ok && allocResp.body && Array.isArray(allocResp.body.data))
        ? allocResp.body.data.filter(a => (a.allocationStatus || '').toUpperCase() !== 'RELEASED')
        : [];

      // Restore allocationId onto the visible (yard-scoped) units the view
      // dropped it from, so an allocated unit in THIS yard shows "Assigned"
      // (not an Assign button) and can't be re-allocated.
      const patchedRows = lineDetailUnits.patchAllocations(unitsResp.body.data, activeAllocs, ctx.mode);

      const built = lineDetailUnits.buildResources(patchedRows, ctx.mode, ctx.eqpInfo, ctx.eqpMasterId);
      const resources = built.resources;
      // Bars (block a) draw only on VISIBLE units (can't bar a hidden resource).
      const allocated = built.allocated;
      // Capacity / progress must count the WHOLE line — including allocations on
      // units in a yard that isn't shown — so switching yards can't open the
      // door to over-allocating. This is what initScheduler stores as
      // _allocatedSerials (used only for capacity/progress math).
      const allocatedForCapacity = lineDetailUnits.buildAllocatedFromList(activeAllocs, ctx.mode);

      // ── 2. Rebuild event bars (serial mode only; lot/inventory have none) ──
      const events = [];
      if (ctx.mode === 'serial') {
        const inclusiveEnd = bryntumDates.inclusiveEnd;
        const myReqNumber  = $page.variables.requestNumber || '';
        const lineStart    = ctx.lineData && ctx.lineData.start_date;
        const lineEnd      = ctx.lineData && ctx.lineData.end_date;
        let evtSeq = 1;

        // Confirmed? → Booked (blue) vs Reserving (orange). PER-LINE +
        // status-aware (a live TO on THIS line — fusionToStatus==='TO_CREATED' —
        // via resources/js/lineConfirmed). A TO on a sibling line must NOT paint
        // this line's bars Booked.
        let confirmed = false;
        try {
          const toResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getTransferOrders',
            uriParams: { equipmentRequestId: Number(requestId) }
          });
          const tos = (toResp && toResp.ok && toResp.body && toResp.body.data) || [];
          confirmed = await lineConfirmed.lineIsConfirmed(context, Actions, tos, lineId);
        } catch (e) { /* tolerate */ }

        // (a) THIS line's bar(s) — from the units' own allocations. The
        //     scheduler resource id IS the unit ref, which is what
        //     allocated[] now carries.
        if (lineStart && lineEnd) {
          allocated.forEach(a => {
            events.push({
              id:          'evt-' + (evtSeq++),
              resourceId:  a.eqrSerialRefId != null ? a.eqrSerialRefId
                         : a.eqrLotRefId    != null ? a.eqrLotRefId
                         : a.inventoryItemRefId,
              name:        confirmed ? 'Booked' : 'Reserving',
              startDate:   lineStart,
              endDate:     inclusiveEnd(lineEnd),
              eventColor:  confirmed ? '#1565C0' : '#f59e0b',
              requestNumber: myReqNumber,
            });
          });
        }

        // (b) Cross-request "Booked" bars from line-detail-bookings, joined to
        //     the (yard-filtered) resources by unitRefId.
        const resourceIds = new Set(resources.map(r => Number(r.id)));
        if (ctx.eqpMasterId) {
          try {
            const bResp = await Actions.callRest(context, {
              endpoint:  'eqp-v1/getEquipriteV1ViewsLineDetailBookings',
              uriParams: { equipmentMasterId: Number(ctx.eqpMasterId), size: 10000 }
            });
            if (bResp && bResp.ok && bResp.body && Array.isArray(bResp.body.data)) {
              const seen = new Set();
              bResp.body.data.forEach(b => {
                if (!b) return;
                if (String(b.bookingRequestNumber || '') === String(myReqNumber || '')) return;
                const resId = Number(b.unitRefId);
                if (!resourceIds.has(resId)) return;       // unit not in this yard → no bar
                const s = b.bookingStartDate, e = b.bookingEndDate;
                if (!s || !e) return;
                const key = resId + '|' + (b.bookingRequestNumber || '') + '|' + s + '|' + e;
                if (seen.has(key)) return;
                seen.add(key);
                events.push({
                  id:          'evt-' + (evtSeq++),
                  resourceId:  resId,
                  name:        'Booked',
                  startDate:   s,
                  endDate:     inclusiveEnd(e),
                  eventColor:  '#1565C0',
                  requestNumber: b.bookingRequestNumber || '',
                  projectName:  b.projectName || '',
                  taskName:     b.taskName || '',
                });
              });
            }
          } catch (e) { /* tolerate */ }
        }
      }

      // ── 3. Rebuild the picker in place (resets staging — correct, the unit
      //       set just changed under the user). Pass the WHOLE-LINE allocation
      //       set (not just visible units) so capacity math stays correct when
      //       the allocated unit lives in a yard that isn't shown. ───────────
      $page.variables.lineHasAllocations = allocatedForCapacity.length > 0;
      $page.functions.initScheduler(resources, events, ctx.lineData, allocatedForCapacity, ctx.mode);
    }
  }

  return RescopeYardChain;
});
