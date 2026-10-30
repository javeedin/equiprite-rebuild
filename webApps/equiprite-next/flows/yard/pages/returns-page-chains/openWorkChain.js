define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestDetailLines',
  'resources/js/yardWork',
], (ActionChain, Actions, rdl, yw) => {
  'use strict';

  // Opens a request beside the list to receive what came back. New EquipRite's receipt openPickingDrawerChain, with the
  // same calls in the same order; only where the result goes is Next's:
  //   1. transfer-orders?equipmentRequestId                 its transfer orders, newest first
  //   2. transfer-order-lines?transferOrderId (each)        which line is on which order (the return one included)
  //   3. equipment-requests/{id}/lines?size=2000            every line
  //   4. views/line-detail-units?requestId&lineId (each)    its unit, condition and the yard it came from
  // Reads only. Opening clears the ticks and the return date (only lines shipped back to the yard can be ticked).

  const POST_RELEASE_STATUSES = ['CANCELLED', 'CANCELED', 'CLOSED', 'RELEASED', 'SHIPPED'];

  function derivePickingStatus(allocCount, qty) {
    if (allocCount === 0) return 'PENDING';
    if (allocCount >= (qty || 1)) return 'ALLOCATED';
    return 'IN_PROGRESS';
  }

  function deriveCondition(currentStatus) {
    const s = (currentStatus || '').toUpperCase();
    if (s === 'DAMAGED' || s === 'BROKEN') return 'DAMAGED';
    if (s === 'EXPIRED' || s === 'OBSOLETE') return 'EXPIRED';
    if (s === 'RETIRED' || s === 'SCRAPPED') return 'RETIRED';
    return 'GOOD';
  }

  class openWorkChain extends ActionChain {
    async run(context, { id, keepBanner }) {
      const v = context.$page.variables;
      const key = String(id || '');
      if (!key) return;
      const rowData = (v.records || []).filter((r) => String(r.id) === key)[0] || (String(v.openId) === key ? v.work.req : null);
      if (!rowData) return;
      const first = String(v.openId) !== key || v.side !== 'request';
      v.side = 'request';
      v.openId = key;
      v.exportOpen = '';
      v.workError = '';
      v.workLoading = true;
      if (first || !keepBanner) v.banner = { type: '', text: '' };
      if (first) v.work = { req: rowData, lines: [], tos: [], yards: '' };
      v.ticks = [];
      const requestId = rowData.eqrEquipmentRequestId || rowData.id;
      try {
        let hasActiveTO = false;
        let requestTOs = [];
        try {
          const toResp = await Actions.callRest(context, { endpoint: 'eqp-v1/getTransferOrders', uriParams: { equipmentRequestId: Number(requestId) } });
          if (toResp && toResp.ok) {
            requestTOs = (toResp.body && toResp.body.data) || [];
            requestTOs.sort((a, b) => {
              const da = a.createdDate ? new Date(a.createdDate).getTime() : 0;
              const db = b.createdDate ? new Date(b.createdDate).getTime() : 0;
              return db - da;
            });
            hasActiveTO = requestTOs.some((t) => POST_RELEASE_STATUSES.indexOf((t.orderStatus || '').toUpperCase()) === -1);
          }
        } catch (e) {
          console.warn('[openWorkChain] TO fetch failed:', e);
        }

        const requestLineToTOMap = new Map();
        if (requestTOs.length > 0) {
          const toLineResults = await Promise.all(requestTOs.map((t) => Actions.callRest(context, {
            endpoint: 'eqp-v1/getTransferOrderLines', uriParams: { transferOrderId: Number(t.id) },
          }).catch((e) => ({ ok: false, _err: e }))));
          requestTOs.forEach((t, idx) => {
            const r = toLineResults[idx];
            if (!r || !r.ok) return;
            const orderNumber = t.orderNumber || '';
            ((r.body && r.body.data) || []).forEach((toLine) => {
              if (toLine.requestLineId != null && orderNumber && !requestLineToTOMap.has(toLine.requestLineId)) {
                requestLineToTOMap.set(toLine.requestLineId, { orderNumber, orderStatus: t.orderStatus || '' });
              }
            });
          });
        }

        const linesResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2', uriParams: { requestId: Number(requestId), size: 2000 },
        }).catch((e) => { console.warn('[openWorkChain] lines fetch failed:', e); return null; });
        // Another request was opened meanwhile (or the panel closed): this answer is not for it.
        if (String(v.openId) !== key || v.side !== 'request') return;
        if (!linesResp || !linesResp.ok) {
          v.workError = 'The lines of ' + (rowData.requestNumber || 'this request') + ' could not be loaded (HTTP ' + (linesResp && linesResp.status) + '). Try Refresh.';
          return;
        }
        const canonicalLines = (linesResp.body && linesResp.body.data) || [];

        const unitResults = await Promise.all(canonicalLines.map((line) => Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsLineDetailUnits', uriParams: { requestId: Number(requestId), lineId: Number(line.id), size: 10000 },
        }).catch((e) => ({ ok: false, _err: e }))));

        const lines = canonicalLines.map((line, idx) => {
          const r = unitResults[idx];
          const unitRows = r && r.ok ? ((r.body && r.body.data) || []) : [];
          const eqInfo = unitRows.length ? { equipmentName: unitRows[0].equipmentName || '', className: unitRows[0].className || '' } : {};
          const allocRows = unitRows.filter((u) => u.allocationId != null);
          const allocSerials = allocRows.map((u) => ({ serialNumber: u.unitNumber || '', currentStatus: u.unitStatus || '' }));
          const worstCondition = allocSerials.reduce((acc, s) => {
            const c = deriveCondition(s.currentStatus);
            if (c === 'GOOD') return acc;
            return acc && acc !== 'GOOD' ? acc : c;
          }, 'GOOD');
          let pickingStatus;
          if (worstCondition !== 'GOOD') {
            pickingStatus = 'EXCEPTION';
          } else {
            pickingStatus = derivePickingStatus(allocRows.length, line.quantity);
            if (pickingStatus === 'ALLOCATED' && !hasActiveTO) pickingStatus = 'IN_PROGRESS';
          }
          const toInfo = requestLineToTOMap.get(line.id) || null;
          const classRow = line.fulfilmentClass ? line : (unitRows[0] || line);
          return {
            lineId: String(line.id),
            equipmentMasterId: line.eqrEquipmentMasterId,
            equipmentName: eqInfo.equipmentName || '',
            equipmentClass: eqInfo.className || '',
            serialNumber: allocSerials.map((s) => s.serialNumber).filter(Boolean).join(', '),
            quantity: line.quantity || 1,
            allocatedCount: allocRows.length,
            pickingStatus,
            condition: worstCondition,
            notes: line.lineNotes || '',
            toNumber: toInfo ? toInfo.orderNumber : '',
            lineStatus: line.lineStatus || '',
            requestStatus: (rowData && rowData.status) || '',
            // Next's display only: where it goes back to, and whether it has a transfer order at all.
            yard: yw.yardOfUnits(unitRows),
            isFAndM: rdl.isFAndM(classRow),
          };
        });
        if (String(v.openId) !== key || v.side !== 'request') return;
        // Kept in load order: what Receive sends follows it, as in New (the page shows them back-at-the-yard first).
        v.work = {
          req: rowData,
          lines,
          tos: requestTOs.map((t) => ({ value: String(t.id), orderNumber: t.orderNumber || '', orderStatus: t.orderStatus || '' })),
          yards: [...new Set(lines.map((l) => l.yard).join(', ').split(',').map((y) => y.trim()).filter((y) => !!y))].join(', '),
        };
      } catch (e) {
        console.error('[openWorkChain] failed', e);
        if (String(v.openId) === key) v.workError = 'The request could not be opened: ' + ((e && e.message) || e);
      } finally {
        if (String(v.openId) === key) v.workLoading = false;
      }
    }
  }

  return openWorkChain;
});
