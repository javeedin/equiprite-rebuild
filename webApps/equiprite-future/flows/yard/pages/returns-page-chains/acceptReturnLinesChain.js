define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser',
  'resources/js/requestData',
  'resources/js/yardWork',
], (ActionChain, Actions, lineBody, cu, requestData, yw) => {
  'use strict';

  // Receive at yard: New's AcceptReturnLinesChain, with the same calls in the same order. EquipRite's own data only:
  //   1. PATCH equipment-requests/{id}/lines/batch   { lines: [{ id, lineStatus: 'CLOSED', actualReturnDate }] }, one
  //      transaction, for the ticked lines shipped back to the yard (SHIPPED_TO_YARD); the date is the day it came back
  //      (blank: today), sent as a full datetime (T00:00:00Z)
  //   2. for each line that closed: GET allocations?requestLineId, then each unit not released back in stock:
  //      PATCH serial-refs/{id} { unitStatus: 'AVAILABLE' } | lot-refs/{id} { lotStatus: 'ACTIVE' } |
  //      inventory-item-refs/{id} { itemStatus: 'ACTIVE' }
  //   3. GET equipment-requests/{id}/lines?size=2000 and, when every line is closed, rejected or consumed (and one is
  //      closed or consumed): PATCH equipment-requests/{id} { status: 'CLOSED' }
  //   4. the request read again; the result in words on the page.
  // Nothing is sent to Fusion.
  const SOURCE_STATE = 'SHIPPED_TO_YARD';
  const TARGET_STATE = 'CLOSED';
  const CLOSE_TERMINAL_STATES = ['CLOSED', 'REJECTED', 'CONSUMED'];

  class acceptReturnLinesChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const req = v.work.req;
      const requestId = req && (req.eqrEquipmentRequestId || req.id);
      if (!requestId) return;

      const selected = yw.selectedLines(v.work.lines, v.ticks);
      const eligible = selected.filter((l) => l && l.lineStatus === SOURCE_STATE);
      if (eligible.length === 0) return;

      const retDay = (v.returnDate && String(v.returnDate).slice(0, 10)) || new Date().toISOString().slice(0, 10);
      const actualReturnDate = retDay + 'T00:00:00Z';

      const closeBatch = await lineBody.updateLines(context, Actions, {
        requestId: Number(requestId),
        headers: cu.auditHeaders(context),
        updates: eligible.map((l) => ({ id: Number(l.lineId), lineStatus: TARGET_STATE, actualReturnDate })),
      });
      if (!closeBatch.ok) console.warn('[acceptReturnLinesChain] close batch failed, no line changed:', closeBatch.message);
      const failures = closeBatch.ok ? 0 : eligible.length;
      const updated = eligible.length - failures;

      // Units back to stock, only for lines that closed.
      const closedLines = closeBatch.ok ? eligible : [];
      let unitsReleased = 0;
      const unitFailures = [];
      await Promise.all(closedLines.map(async (l) => {
        let allocs = [];
        try {
          const r = await Actions.callRest(context, { endpoint: 'eqp-v1/getAllocations', uriParams: { requestLineId: Number(l.lineId) } });
          allocs = (r && r.ok && r.body && Array.isArray(r.body.data)) ? r.body.data : [];
        } catch (e) {
          console.warn('[acceptReturnLinesChain] allocations fetch failed for line', l.lineId, e);
          return;
        }
        const unitTargets = allocs
          .filter((a) => a && String(a.allocationStatus || '').toUpperCase() !== 'RELEASED' && !a.releasedDate)
          .map((a) => {
            if (a.eqrSerialRefId != null) return { type: 'SERIAL', id: Number(a.eqrSerialRefId) };
            if (a.eqrLotRefId != null) return { type: 'LOT', id: Number(a.eqrLotRefId) };
            if (a.inventoryItemRefId != null) return { type: 'ITEM', id: Number(a.inventoryItemRefId) };
            return null;
          })
          .filter(Boolean);
        const seenUnits = new Set();
        const uniqueTargets = unitTargets.filter((t) => {
          const k = t.type + ':' + t.id;
          if (seenUnits.has(k)) return false;
          seenUnits.add(k);
          return true;
        });
        await Promise.all(uniqueTargets.map(async (target) => {
          try {
            const spec = target.type === 'LOT'
              ? { endpoint: 'eqp-v1/patchLotRef', body: { lotStatus: 'ACTIVE' } }
              : target.type === 'ITEM'
                ? { endpoint: 'eqp-v1/patchInventoryItemRef', body: { itemStatus: 'ACTIVE' } }
                : { endpoint: 'eqp-v1/patchSerialRef', body: { unitStatus: 'AVAILABLE' } };
            const r2 = await Actions.callRest(context, { endpoint: spec.endpoint, uriParams: { id: target.id }, body: spec.body });
            if (r2 && r2.ok) unitsReleased += 1;
            else unitFailures.push(target.id);
          } catch (e) {
            console.warn('[acceptReturnLinesChain] unit release failed for', target.type, target.id, e);
            unitFailures.push(target.id);
          }
        }));
      }));

      // The request closes once every line is finished.
      let headerClosed = false;
      const verifyResult = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
        uriParams: { requestId: Number(requestId), size: 2000 },
      }).catch((e) => ({ ok: false, error: e }));
      if (verifyResult.ok && verifyResult.body && Array.isArray(verifyResult.body.data)) {
        const lines = verifyResult.body.data;
        const allTerminal = lines.length > 0
          && lines.every((l) => CLOSE_TERMINAL_STATES.indexOf(l.lineStatus) !== -1)
          && lines.some((l) => l.lineStatus === 'CLOSED' || l.lineStatus === 'CONSUMED');
        if (allTerminal) {
          const headerPatch = await Actions.callRest(context, {
            endpoint: 'eqp-v1/patchEquipmentRequest',
            uriParams: { id: Number(requestId) },
            body: { status: 'CLOSED' },
          }).catch((e) => ({ ok: false, error: e }));
          if (headerPatch.ok) headerClosed = true;
          else console.warn('[acceptReturnLinesChain] header CLOSED PATCH failed:', headerPatch.status);
        }
      } else {
        console.warn('[acceptReturnLinesChain] line read-back failed; header left unchanged.');
      }

      if (updated) requestData.invalidate();
      await Actions.callChain(context, { chain: 'openWorkChain', params: { id: String(v.openId), keepBanner: true } });
      v.ticks = [];
      v.returnDate = '';

      const problems = failures > 0 || unitFailures.length > 0;
      v.banner = {
        type: failures > 0 && !updated ? 'error' : (problems ? 'warning' : 'confirmation'),
        text: (updated ? updated + (updated === 1 ? ' piece' : ' pieces') + ' received and closed.' : 'Nothing was received: '
          + (closeBatch.message || 'the lines could not be updated.'))
          + (unitsReleased ? ' ' + unitsReleased + (unitsReleased === 1 ? ' unit is' : ' units are') + ' back in stock.' : '')
          + (unitFailures.length ? ' ' + unitFailures.length + (unitFailures.length === 1 ? ' unit' : ' units')
            + ' could not be put back in stock: they still show as rented and need releasing by hand.' : '')
          + (headerClosed ? ' Everything on the request is back: the request is closed.' : ''),
      };
      if (updated) await Actions.callChain(context, { chain: 'refreshRowChain', params: { id: String(v.openId) } });
    }
  }

  return acceptReturnLinesChain;
});
