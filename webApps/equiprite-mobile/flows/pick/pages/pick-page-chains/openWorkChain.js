define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestDetailLines',
  'resources/js/yardWork',
  'resources/js/mobilePick',
  'resources/js/offlineSnapshot',
  'resources/js/currentUser',
], (ActionChain, Actions, rdl, yw, mp, snapshot, cu) => {
  'use strict';

  // Opens a request on its pick list. Next's openWorkChain (New's openPickingDrawerChain), with the same calls in the
  // same order and the same rules:
  //   1. transfer-orders?equipmentRequestId                 its transfer orders, newest first
  //   2. transfer-order-lines?transferOrderId (each)        which line is on which order
  //   3. equipment-requests/{id}/lines?size=2000            the lines; only those in picking are kept
  //                                                          (SCHEDULED_FOR_PICKING, PICK_INITIATED, SHIP_TO_SITE)
  //   4. views/line-detail-units?requestId&lineId (each)    the allocated units, condition and the recorded yard
  //      with serial-refs?equipmentId (each master)         subinventory and locator, in the same wave
  // A transfer order with no line still awaiting release has been released. Reads only.
  // Mobile's own:
  //   - the ticks: a tick is a piece picked (or a fixed asset to release), so the list opens with what this phone
  //     ticked for the request (still tickable), not with Next's opening order ticked (pieces that cannot be picked
  //     until Fusion releases them). The single ticked transfer order follows the ticks (yardWork.selectedTOIdFor), as
  //     after any tick in Next.
  //   - the pick list is saved on the phone; with no connection, or when the lines cannot be read, the saved copy is
  //     shown, saying when, and its steps wait for a fresh read.
  const POST_RELEASE_STATUSES = ['CANCELLED', 'CANCELED', 'CLOSED', 'RELEASED', 'SHIPPED'];
  const PICKING_VISIBLE_LINE_STATUSES = ['SCHEDULED_FOR_PICKING', 'PICK_INITIATED', 'SHIP_TO_SITE'];
  const PRE_RELEASE_LINE_STATUSES = ['ALLOCATED', 'SCHEDULED_FOR_PICKING', 'PENDING_ALLOCATION', 'UNALLOCATED', ''];

  function statusLabel(orderNumber, fallback, released) {
    const base = orderNumber ? String(orderNumber) : (fallback || 'TO pending');
    return base + (released ? ' — Released' : ' — Awaiting release');
  }

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

  async function fetchUnitRefs(context, masterIds) {
    const byId = {};
    if (!masterIds.length) return byId;
    const results = await Promise.all(masterIds.map((id) => Actions.callRest(context, {
      endpoint: 'eqp-v1/getSerialRefs',
      uriParams: { equipmentId: Number(id), page: 0, size: 500 },
    }).catch((e) => ({ ok: false, _err: e }))));
    results.forEach((r, idx) => {
      if (!r || !r.ok) {
        console.warn('[openWorkChain] unit-refs fetch failed for equipment', masterIds[idx], r && r._err);
        return;
      }
      ((r.body && r.body.data) || []).forEach((ref) => { if (ref && ref.id != null) byId[String(ref.id)] = ref; });
    });
    return byId;
  }

  function distinctRefValues(units, unitRefsById, pick) {
    const seen = [];
    (units || []).forEach((u) => {
      if (String(u.unitType || '').toUpperCase() !== 'SERIAL') return;
      const ref = u.unitRefId != null ? unitRefsById[String(u.unitRefId)] : null;
      const val = ref ? String(pick(ref) == null ? '' : pick(ref)).trim() : '';
      if (val && seen.indexOf(val) === -1) seen.push(val);
    });
    return seen.join(', ');
  }

  class openWorkChain extends ActionChain {
    async run(context, { id, keepBanner }) {
      const { $application } = context;
      const v = context.$page.variables;
      const key = String(id || '');
      if (!key) return;
      const user = cu.auditActor(context) || ($application.user || {}).username || '';
      const kept = mp.read(snapshot, user);
      const savedWork = mp.workOf(kept, key);
      const found = (v.records || []).filter((r) => String(r.id) === key)[0] || (String(v.openId) === key ? v.work.req : null)
        || (savedWork && savedWork.work && savedWork.work.req) || null;
      if (!found) return;
      // A plain copy: v.work is replaced below, and a page variable's old proxy cannot be read after.
      const rowData = JSON.parse(JSON.stringify(found));
      const first = String(v.openId) !== key || v.view !== 'work';
      if (first && v.view !== 'work' && typeof window !== 'undefined') v.listY = window.scrollY || 0;
      v.openId = key;
      v.view = 'work';
      v.workError = '';
      v.workSaved = '';
      v.workLoading = true;
      if (first || !keepBanner) v.banner = { type: '', text: '' };
      if (first) {
        if (v.slip && v.slip.url) { try { URL.revokeObjectURL(v.slip.url); } catch (e) { /* gone */ } }
        v.slip = { url: '', fileName: '', docNumber: '', rows: 0 };
        v.work = { req: rowData, lines: [], exceptions: [], tos: [], yards: '' };
        v.ticks = [];
        v.selectedTOId = '';
        v.flash = '';
        v.check = mp.checklist(null, [], '', {});
        if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
      }
      const requestId = rowData.eqrEquipmentRequestId || rowData.id;
      // The pick list as this phone saved it, with its ticks; its steps wait for a fresh read.
      const fromPhone = (why) => {
        if (!savedWork || !savedWork.work || String(v.openId) !== key) return false;
        const work = savedWork.work;
        const entry = mp.ticksOf(kept, key, Date.now());
        const ticks = mp.liveTicks(work.lines, entry ? entry.ticks : []);
        const selectedTOId = yw.selectedTOIdFor(work.tos, work.lines, ticks);
        v.work = work;
        v.selectedTOId = selectedTOId;
        v.ticks = ticks;
        v.check = mp.checklist(work, ticks, selectedTOId, { syncOn: v.can.sync, external: work.req && work.req.isCustomer });
        v.workSaved = (why ? why + ' ' : '') + snapshot.savedText(savedWork.at, Date.now());
        return true;
      };
      try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          if (!fromPhone('No connection.')) {
            v.workError = 'No connection, and this phone has no saved copy of ' + (rowData.requestNumber || 'this request') + ': open it once with a connection.';
          }
          return;
        }
        // ── 1, 2: transfer orders and their lines ──────────────────────────────────────────────────────
        let hasActiveTO = false;
        let requestTOs = [];
        let options = [];
        try {
          const toResp = await Actions.callRest(context, { endpoint: 'eqp-v1/getTransferOrders', uriParams: { equipmentRequestId: Number(requestId) } });
          if (toResp && toResp.ok) {
            requestTOs = (toResp.body && toResp.body.data) || [];
            requestTOs.sort((a, b) => {
              const da = a.createdDate ? new Date(a.createdDate).getTime() : 0;
              const db = b.createdDate ? new Date(b.createdDate).getTime() : 0;
              return db - da;
            });
            const isReleasable = (t) => POST_RELEASE_STATUSES.indexOf((t.orderStatus || '').toUpperCase()) === -1;
            hasActiveTO = requestTOs.some(isReleasable);
            options = requestTOs.filter(isReleasable).map((t) => ({
              value: String(t.id), label: t.orderNumber ? String(t.orderNumber) : 'TO pending', orderNumber: t.orderNumber || '', orderStatus: t.orderStatus || '',
            }));
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
            const orderStatus = t.orderStatus || '';
            ((r.body && r.body.data) || []).forEach((toLine) => {
              if (toLine.requestLineId != null && orderNumber && !requestLineToTOMap.has(toLine.requestLineId)) {
                requestLineToTOMap.set(toLine.requestLineId, { orderNumber, orderStatus });
              }
            });
          });
        }

        // ── 3: the lines, only those in picking ────────────────────────────────────────────────────────
        const linesResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2', uriParams: { requestId: Number(requestId), size: 2000 },
        }).catch((e) => { console.warn('[openWorkChain] lines fetch failed:', e); return null; });
        if (String(v.openId) !== key) return;
        if (!linesResp || !linesResp.ok) {
          const why = 'The lines of ' + (rowData.requestNumber || 'this request') + ' could not be loaded (HTTP ' + (linesResp && linesResp.status) + ').';
          if (!fromPhone(why)) v.workError = why + ' Try Refresh.';
          return;
        }
        const allLines = (linesResp.body && linesResp.body.data) || [];
        const canonicalLines = allLines.filter((l) => PICKING_VISIBLE_LINE_STATUSES.indexOf(String((l && l.lineStatus) || '').toUpperCase()) !== -1);

        // ── 4: units per line and locators per master, one wave ────────────────────────────────────────
        const [unitResults, unitRefsById] = await Promise.all([
          Promise.all(canonicalLines.map((line) => Actions.callRest(context, {
            endpoint: 'eqp-v1/getEquipriteV1ViewsLineDetailUnits', uriParams: { requestId: Number(requestId), lineId: Number(line.id), size: 10000 },
          }).catch((e) => ({ ok: false, _err: e })))),
          fetchUnitRefs(context, [...new Set(canonicalLines.map((l) => l.eqrEquipmentMasterId).filter((x) => x != null))]),
        ]);
        const unitsByLine = new Map();
        canonicalLines.forEach((line, idx) => {
          const r = unitResults[idx];
          unitsByLine.set(line.id, r && r.ok ? ((r.body && r.body.data) || []) : []);
        });

        const exceptions = [];
        const lines = canonicalLines.map((line) => {
          const unitRows = unitsByLine.get(line.id) || [];
          const eqInfo = unitRows.length ? { equipmentName: unitRows[0].equipmentName || '', className: unitRows[0].className || '' } : {};
          const allocRows = unitRows.filter((u) => u.allocationId != null);
          const allocSerials = allocRows.map((u) => ({
            serialNumber: u.unitNumber || '', currentStatus: u.unitStatus || '', unitRefId: u.unitRefId != null ? u.unitRefId : null, unitType: u.unitType || '',
          }));
          const serialNumber = allocSerials.map((s) => s.serialNumber).filter(Boolean).join(', ');
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
          if (pickingStatus === 'EXCEPTION') {
            const bad = allocSerials.filter((s) => deriveCondition(s.currentStatus) !== 'GOOD')[0];
            exceptions.push({
              lineId: String(line.id),
              equipmentName: eqInfo.equipmentName || '',
              issue: bad ? ('Serial ' + bad.serialNumber + ' is ' + worstCondition + '. Assign an alternate serial.') : 'Allocated serial flagged for review.',
              severity: worstCondition === 'EXPIRED' ? 'CRITICAL' : 'HIGH',
            });
          }
          const toInfo = requestLineToTOMap.get(line.id) || null;
          const classRow = line.fulfilmentClass ? line : (unitRows[0] || line);
          return {
            lineId: String(line.id),
            equipmentMasterId: line.eqrEquipmentMasterId,
            equipmentName: eqInfo.equipmentName || '',
            equipmentClass: eqInfo.className || '',
            serialNumber,
            allocUnits: allocSerials,
            subinventory: distinctRefValues(allocSerials, unitRefsById, (r) => r.currentSubinventory),
            locator: distinctRefValues(allocSerials, unitRefsById, (r) => r.currentLocator),
            yard: yw.yardOfUnits(unitRows),
            quantity: line.quantity || 1,
            allocatedCount: allocRows.length,
            pickingStatus,
            condition: worstCondition,
            notes: line.lineNotes || '',
            toNumber: toInfo ? toInfo.orderNumber : '',
            lineStatus: line.lineStatus || '',
            requestStatus: (rowData && rowData.status) || '',
            fulfilmentClass: rdl.classOfLine(classRow),
            isFAndM: rdl.isFAndM(classRow),
            // For the pick list's note on Pick and ship only (the ship chain decides from the server's rows).
            maintenanceTracked: line.isMaintenanceTracked,
            transactable: line.isTransactable,
          };
        });

        // ── Transfer orders with no line awaiting release have been released ──────────────────────────
        const awaitingByTO = new Map();
        lines.forEach((l) => {
          const num = String(l.toNumber || '');
          if (!num) return;
          const awaiting = PRE_RELEASE_LINE_STATUSES.indexOf(String(l.lineStatus || '').toUpperCase()) > -1;
          awaitingByTO.set(num, (awaitingByTO.get(num) || false) || awaiting);
        });
        const releasedTONumbers = new Set();
        awaitingByTO.forEach((stillAwaiting, num) => { if (!stillAwaiting) releasedTONumbers.add(num); });
        const tos = options.map((t) => {
          const isReleased = !!(t.orderNumber && releasedTONumbers.has(String(t.orderNumber)));
          return Object.assign({}, t, { released: isReleased, label: statusLabel(t.orderNumber, t.label, isReleased) });
        });
        // Another request was opened meanwhile: this answer is not for the pick list any more.
        if (String(v.openId) !== key) return;

        const work = {
          req: rowData,
          lines,
          exceptions,
          tos,
          yards: [...new Set(lines.map((l) => l.yard).join(', ').split(',').map((y) => y.trim()).filter((y) => !!y))].join(', '),
        };
        // Mobile: the ticks this phone kept for the request (still tickable); the single ticked order follows them.
        const entry = mp.ticksOf(kept, key, Date.now());
        const ticks = mp.liveTicks(lines, entry ? entry.ticks : []);
        const selectedTOId = yw.selectedTOIdFor(tos, lines, ticks);
        v.work = work;
        v.selectedTOId = selectedTOId;
        v.ticks = ticks;
        v.check = mp.checklist(work, ticks, selectedTOId, { syncOn: v.can.sync, external: rowData.isCustomer });
        mp.keep(snapshot, user, (k, at) => mp.withTicks(mp.withWork(k, JSON.parse(JSON.stringify(work)), at), key, rowData.requestNumber, ticks, undefined, at));
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
