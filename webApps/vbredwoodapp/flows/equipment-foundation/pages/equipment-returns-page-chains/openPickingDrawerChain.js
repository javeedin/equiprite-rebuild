define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Derived UI status for a line:
  //   PENDING     = no allocations yet
  //   IN_PROGRESS = some allocations but not full qty, OR full qty without a TO
  //   ALLOCATED   = full qty allocated AND a non-cancelled TO exists on the request
  //   EXCEPTION   = serial flagged DAMAGED / EXPIRED / RETIRED (best-effort)
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

  class openPickingDrawerChain extends ActionChain {
    async run(context, { rowData }) {
      const { $page } = context;
      if (!rowData) return;

      // Show the modal with whatever header info we already have, then
      // enrich with lines fetched from the API.
      $page.variables.selectedRequest = {
        ...rowData,
        lines: [],
        pickingExceptions: [],
      };
      $page.variables.isDrawerOpen = true;
      $page.variables.isLoadingDrawer = true;

      const dialog = document.getElementById('pickingDetailDialog');
      if (dialog && typeof dialog.open === 'function') dialog.open();

      // Reset TO dropdown state for the new request
      $page.variables.selectedRequestTOs = [];
      $page.variables.selectedTOId = '';

      const requestId = rowData.eqrEquipmentRequestId || rowData.id;
      if (!requestId) {
        $page.variables.isLoadingDrawer = false;
        return;
      }

      // ── Load Transfer Orders for this request (drives the dropdown) ─────
      // A line can only show ALLOCATED if at least one non-cancelled TO
      // exists on this request — that's the "TO has been created/released"
      // gate. We track the flag here so the line-build step can read it.
      let hasActiveTO = false;
      let requestTOs = [];
      try {
        const toResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getTransferOrders',
          uriParams: { equipmentRequestId: Number(requestId) }
        });
        if (toResp && toResp.ok) {
          requestTOs = toResp.body.data || [];
          // Sort by createdDate desc so most-recent TO is first / auto-selected.
          requestTOs.sort((a, b) => {
            const da = a.createdDate ? new Date(a.createdDate).getTime() : 0;
            const db = b.createdDate ? new Date(b.createdDate).getTime() : 0;
            return db - da;
          });
          // Statuses that mean the TO is no longer release-eligible. CANCELLED
          // / CANCELED have been excluded since day one; CLOSED / RELEASED /
          // SHIPPED are added so that once Fusion (or the local mirror) flips
          // a TO post-release, it disappears from the dropdown. Until the
          // backend reflects the released status, the in-session splice in
          // ReleaseTransferOrderChain handles the just-released case.
          const POST_RELEASE_STATUSES = ['CANCELLED', 'CANCELED', 'CLOSED', 'RELEASED', 'SHIPPED'];
          const isReleasable = (t) => {
            const s = (t.orderStatus || '').toUpperCase();
            return POST_RELEASE_STATUSES.indexOf(s) === -1;
          };
          hasActiveTO = requestTOs.some(isReleasable);
          const options = requestTOs.filter(isReleasable).map(t => {
            const num = t.orderNumber || '';
            const status = t.orderStatus || '';
            const label = num ? String(num) : 'TO pending';
            return {
              value: String(t.id),
              label: label,
              orderNumber: num,
              orderStatus: status,
            };
          });
          $page.variables.selectedRequestTOs = options;
          if (options.length) $page.variables.selectedTOId = options[0].value;
          else $page.variables.selectedTOId = '';
        }
      } catch (e) {
        console.warn('[openPickingDrawer] TO fetch failed:', e);
      }

      // ── Fetch TO lines for every TO on this request and build a
      //    requestLineId -> { orderNumber, orderStatus } map. orderNumber
      //    drives the TO Number column; orderStatus is kept for the
      //    hasActiveTO gate that downgrades ALLOCATED → IN_PROGRESS. ─────
      const requestLineToTOMap = new Map();
      if (requestTOs.length > 0) {
        const toLineResults = await Promise.all(
          requestTOs.map(t =>
            Actions.callRest(context, {
              endpoint: 'eqp-v1/getTransferOrderLines',
              uriParams: { transferOrderId: Number(t.id) }
            }).catch(e => ({ ok: false, _err: e }))
          )
        );
        requestTOs.forEach((t, idx) => {
          const r = toLineResults[idx];
          if (!r || !r.ok) return;
          const orderNumber = t.orderNumber || '';
          const orderStatus = t.orderStatus || '';
          (r.body.data || []).forEach(toLine => {
            if (toLine.requestLineId != null && orderNumber) {
              // First TO covering a given request-line wins (most recent due to sort).
              if (!requestLineToTOMap.has(toLine.requestLineId)) {
                requestLineToTOMap.set(toLine.requestLineId, { orderNumber, orderStatus });
              }
            }
          });
        });
      }

      // ── Canonical line list — the lines to iterate, source of quantity /
      //    lineStatus / eqrEquipmentMasterId ────────────────────────────────
      const linesResp = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
        uriParams: { requestId: Number(requestId), size: 2000 }
      }).catch(e => { console.warn('[openPickingDrawer] lines fetch failed:', e); return null; });

      const canonicalLines = (linesResp && linesResp.ok) ? (linesResp.body.data || []) : [];

      // ── One views/line-detail-units call per line (parallel). Each returns
      //    one row per physical unit of the line's master, carrying
      //    equipmentName + className + per-unit unitNumber/unitStatus AND this
      //    line's live allocation join (allocationId/allocatedQty/
      //    allocationStatus). Replaces the old equipment-catalog lookup +
      //    global getAllocations + per-master serial-refs fan-out.
      //    No yardId (the drawer has no yard scope — and yardId drops
      //    allocationId on this view); no dates (uses the line's saved window,
      //    so no required-param 400 like the old equipment-catalog call). ───
      const unitResults = await Promise.all(
        canonicalLines.map(line =>
          Actions.callRest(context, {
            endpoint: 'eqp-v1/getEquipriteV1ViewsLineDetailUnits',
            uriParams: { requestId: Number(requestId), lineId: Number(line.id), size: 10000 }
          }).catch(e => ({ ok: false, _err: e }))
        )
      );
      // lineId -> raw unit rows for that line
      const unitsByLine = new Map();
      canonicalLines.forEach((line, idx) => {
        const r = unitResults[idx];
        if (!r || !r.ok) {
          if (r && r._err) console.warn('[openPickingDrawer] line-detail-units fetch failed for line', line.id, r._err);
          unitsByLine.set(line.id, []);
          return;
        }
        unitsByLine.set(line.id, r.body.data || []);
      });

      // ── Build the drawer's line + exception arrays ──────────────────────
      const exceptions = [];
      const lines = canonicalLines.map(line => {
        const unitRows = unitsByLine.get(line.id) || [];
        // Name + class repeat on every unit row — first row wins.
        const eqInfo = unitRows.length
          ? { equipmentName: unitRows[0].equipmentName || '', className: unitRows[0].className || '' }
          : {};
        // Rows allocated to THIS line carry a non-null allocationId. Each such
        // row is one allocation (serial: 1 unit; lot/inventory: one alloc
        // record w/ allocatedQty) — matches the old allocs.length semantics.
        const allocRows = unitRows.filter(u => u.allocationId != null);
        const allocs = allocRows;  // alias: status derivation reads allocs.length
        const allocSerials = allocRows.map(u => ({
          serialNumber: u.unitNumber || '',
          // line-detail-units exposes the unit's status column as unitStatus;
          // deriveCondition()/exception checks read .currentStatus, so map it.
          currentStatus: u.unitStatus || '',
        }));

        const serialNumber = allocSerials.map(s => s.serialNumber).filter(Boolean).join(', ');
        const worstCondition = allocSerials.reduce((acc, s) => {
          const c = deriveCondition(s.currentStatus);
          if (c === 'GOOD') return acc;
          return acc && acc !== 'GOOD' ? acc : c;
        }, 'GOOD');

        let pickingStatus;
        if (worstCondition !== 'GOOD') {
          pickingStatus = 'EXCEPTION';
        } else {
          pickingStatus = derivePickingStatus(allocs.length, line.quantity);
          // Gate: ALLOCATED requires a non-cancelled TO on the request.
          if (pickingStatus === 'ALLOCATED' && !hasActiveTO) {
            pickingStatus = 'IN_PROGRESS';
          }
        }

        if (pickingStatus === 'EXCEPTION') {
          exceptions.push({
            lineId: String(line.id),
            equipmentName: eqInfo.equipmentName || '',
            issue: allocSerials.find(s => deriveCondition(s.currentStatus) !== 'GOOD')
              ? ('Serial ' +
                allocSerials.find(s => deriveCondition(s.currentStatus) !== 'GOOD').serialNumber +
                ' is ' + worstCondition + '. Assign an alternate serial.')
              : 'Allocated serial flagged for review.',
            severity: worstCondition === 'EXPIRED' ? 'CRITICAL' : 'HIGH',
          });
        }

        const toInfo = requestLineToTOMap.get(line.id) || null;
        return {
          lineId: String(line.id),
          equipmentMasterId: line.eqrEquipmentMasterId,
          equipmentName: eqInfo.equipmentName || '',
          equipmentClass: eqInfo.className || '',
          serialNumber: serialNumber,
          altSerialNumber: '',
          quantity: line.quantity || 1,
          allocatedCount: allocs.length,
          pickingStatus: pickingStatus,
          condition: worstCondition,
          notes: line.lineNotes || '',
          toNumber: toInfo ? toInfo.orderNumber : '',
          // Per-line backend status (drives Line Status column + blank-out).
          // Spec doesn't list this in RequestLineDto but the DB column
          // exists; we read it defensively and fall back to '' if absent.
          lineStatus: line.lineStatus || '',
          // Request header status — kept on the line object for downstream
          // use even though it isn't rendered as its own column.
          requestStatus: (rowData && rowData.status) || '',
        };
      });

      console.log('[openPickingDrawer] requestId=', requestId,
        'lines=', lines.length, 'exceptions=', exceptions.length);

      // ── Push enriched data into selectedRequest ────────────────────────
      $page.variables.selectedRequest = {
        ...$page.variables.selectedRequest,
        lines: lines,
        pickingExceptions: exceptions,
      };
      $page.variables.isLoadingDrawer = false;
    }
  }

  return openPickingDrawerChain;
});
