define([], function () {
  'use strict';

  /**
   * DIRECT RETURN — finding equipment that came back without prior notice.
   *
   * Equipment sometimes arrives at the yard with no return initiation, no
   * paperwork and no communication. The operator is standing next to a machine
   * and does NOT know which request it belongs to — which is the whole problem
   * this solves. Every other return path in the app starts from a request you
   * have already opened, so none of them can be used.
   *
   * "Direct" because it goes straight from the equipment in hand to the return,
   * skipping the initiate/notify steps. The return itself is the NORMAL one:
   * inbound Transfer Order, then RETURN_IN_PROCESS. Only the way in is new.
   *
   * Backed by GET /equiprite/v1/views/deployed-units (live 2026-09-09), which
   * joins EQR_UNIT_REF -> EQR_ALLOCATION -> EQR_REQUEST_LINE filtered to lines
   * still out in the field.
   *
   * ── WHY UNIT_REF AND NOT SERIAL_REF ────────────────────────────────────────
   * The view deliberately joins EQR_UNIT_REF. EQR_SERIAL_REF covers only 88 of
   * the active deployed allocations; the rest are LOT and ITEM units, which are
   * just as returnable and would have come back as blank rows. Live split:
   * SERIAL 82, ITEM 39, LOT 19, plus 24 deployed lines with no unit at all that
   * the outer join keeps. So `unitRefId` is the identity, and `serialRefId` /
   * `serialNumber` are the SERIAL-only specialisation.
   *
   * ── WHY THE CALLER MUST NEVER AUTO-SELECT ──────────────────────────────────
   * A serial does not identify a rental. 47% of deployed serials map to more
   * than one line — the same physical unit carries live allocations across
   * requests. Live example, serial BOB-SSL-S76-2024-0001:
   *
   *   line 1000001850  DEPLOYED          EPC_ MO_Operations
   *   line 1000001785  RETURN_INITIATED  EPC_ MO_Operations
   *   line 1000001171  DEPLOYED          Oceaneering Demo
   *
   * Three candidates, two projects, one already return-initiated. Nothing could
   * pick correctly. Returning the wrong one frees a unit that is still on site.
   */

  // Below this the search is not worth running — a single character scans most
  // of the table for no useful narrowing.
  var MIN_QUERY_LENGTH = 2;

  // One screen. NOT a cap standing in for paging: the endpoint returns
  // recordCount so the caller can say "showing 50 of 164" rather than silently
  // truncating. This app has already been bitten twice by fetch-everything
  // sizes — a silent 2000-row cap on equipment-master and a hard 20-row cap on
  // /lines that corrupted status cascades on a 122-line request.
  var DEFAULT_PAGE_SIZE = 50;

  // Both are returnable. A requestor may have initiated a return and the
  // equipment then turned up unannounced, so the line sits at RETURN_INITIATED
  // rather than DEPLOYED. processReturn accepts both, so the lookup must too.
  var RETURNABLE_STATUSES = 'DEPLOYED,RETURN_INITIATED';

  /**
   * Search for equipment still out in the field.
   *
   * @param {Object} context  action-chain / page context
   * @param {Object} Actions  vb Actions
   * @param {Object} opts
   *   q            {string}  broad term — serial, equipment name/number/model,
   *                          class, request number, project or customer
   *   serialNumber {string}  exact match. Matches unit_identifier, so a scanned
   *                          LOT or ITEM label resolves too, not just a serial
   *   page, size   {number}
   *   plus any of: requestId, lineStatus, yardOrgId, equipmentClassId,
   *   equipmentMasterId, requestType, fulfilmentClass, isTransactable, hasSerial,
   *   overdueOnly,
   *   endDateFrom, endDateTo, sort
   *
   * @returns {Promise<{ok, rows, recordCount, page, pageSize, totalPages, hasMore, tooShort}>}
   *   Never throws. `tooShort` is true when the term was under MIN_QUERY_LENGTH,
   *   which is a distinct state from "searched and found nothing" — the UI must
   *   not show an empty-result message for it.
   */
  async function findDeployedUnits(context, Actions, opts) {
    var o = opts || {};
    var term   = (o.q || '').trim();
    var serial = (o.serialNumber || '').trim();

    if (!serial && term.length > 0 && term.length < MIN_QUERY_LENGTH) {
      return { ok: true, rows: [], recordCount: 0, tooShort: true };
    }

    var uriParams = {
      page: Number(o.page) || 0,
      size: Number(o.size) || DEFAULT_PAGE_SIZE,
      // Default to both returnable states unless the caller narrows it.
      lineStatus: o.lineStatus || RETURNABLE_STATUSES
    };
    if (term)   uriParams.q = term;
    if (serial) uriParams.serialNumber = serial;

    // Pass-through filters. Only send what was actually supplied — VB drops
    // undeclared params silently, and sending empty strings would filter on ''.
    ['requestId', 'yardOrgId', 'equipmentClassId', 'equipmentMasterId',
     'requestType', 'fulfilmentClass', 'isTransactable', 'hasSerial', 'overdueOnly',
     'endDateFrom', 'endDateTo', 'sort'].forEach(function (k) {
      if (o[k] !== undefined && o[k] !== null && o[k] !== '') uriParams[k] = o[k];
    });

    try {
      var resp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/searchDeployedUnits',
        uriParams: uriParams
      });
      if (!resp || !resp.ok) {
        console.warn('[directReturn] deployed-units not ok (HTTP ' +
                     (resp && resp.status) + ')');
        return { ok: false, rows: [], recordCount: 0 };
      }
      var b = resp.body || {};
      return {
        ok:          true,
        rows:        (b.data || []).map(mapRow),
        recordCount: b.recordCount || 0,
        page:        b.page || 0,
        pageSize:    b.pageSize || uriParams.size,
        totalPages:  b.totalPages || 0,
        hasMore:     b.hasMore === true,
        tooShort:    false
      };
    } catch (e) {
      console.warn('[directReturn] deployed-units threw:', e);
      return { ok: false, rows: [], recordCount: 0 };
    }
  }

  /**
   * Shape a view row for the grid.
   *
   * `rowKey` is (line, unit) — the endpoint's own grain, and the right one: one
   * unit on one line is one thing to hand back. Backend hit a real bug here,
   * where the count DISTINCTed on (line, unit, allocation) while the data query
   * did not; 11 pairs carry two identical allocation rows, so recordCount said
   * 175 while paging could only ever reach 164. Keying on (line, unit) client
   * side keeps us aligned with the fix.
   *
   * A line with NO unit (24 of them — outer join) has a null unitRefId, so the
   * key falls back to the line alone.
   */
  function mapRow(r) {
    var lineId = Number(r.requestLineId);
    var unitId = r.unitRefId != null ? Number(r.unitRefId) : null;
    return {
      rowKey:         lineId + ':' + (unitId != null ? unitId : 'nounit'),
      // Identity
      unitRefId:      unitId,
      unitType:       r.unitType || null,        // SERIAL | LOT | ITEM | null
      unitIdentifier: r.unitIdentifier || null,
      serialRefId:    r.serialRefId != null ? Number(r.serialRefId) : null,
      serialNumber:   r.serialNumber || null,
      unitStatus:     r.unitStatus || null,
      // Line + request — what the operator reads to tell two rentals apart
      lineId:         lineId,
      lineStatus:     r.lineStatus || null,
      requestId:      Number(r.requestId),
      requestNumber:  r.requestNumber || '',
      requestType:    r.requestType || null,
      // Whichever of the two is populated; INTERNAL has a project, EXTERNAL a customer
      partyName:      r.projectName || r.customerName || '',
      // Equipment
      equipmentName:   r.equipmentName || '',
      equipmentNumber: r.equipmentNumber || '',
      modelNumber:     r.modelNumber || '',
      className:       r.className || '',
      // S&T / F&M for the line — EQR_REQUEST_LINE.FULFILMENT_CLASS. Null only
      // on a line with no item. isTransactable is the ITEM flag alone and is
      // kept for display; it ignores the yards, so never route on it.
      fulfilmentClass: r.fulfilmentClass || null,
      isTransactable:  r.isTransactable || 'Y',
      // Dates — `overdue` is computed SERVER-side; do not re-derive it here or
      // the grid and the filter would disagree on the boundary.
      startDate:      r.startDate || null,
      endDate:        r.endDate || null,
      overdue:        r.overdue === true,
      quantity:       r.quantity != null ? Number(r.quantity) : null,
      allocatedQty:   r.allocatedQty != null ? Number(r.allocatedQty) : null,
      // Yard — also server-side, from the UNIT (populated on 88) rather than
      // the line's SOURCE_ORG_CODE (only 20). Filtering on the line's code
      // would have hidden 88% of units.
      yardOrgId:      r.yardOrgId != null ? Number(r.yardOrgId) : null,
      yardOrgName:    r.yardOrgName || '',
      sourceOrgCode:  r.sourceOrgCode || null
    };
  }

  /**
   * Group rows by request, because the return runs per request: each request's
   * lines are planned, reserved and recorded independently.
   *
   * @returns {Array<{requestId, requestNumber, lineIds:number[], rows:[]}>}
   */
  function groupByRequest(rows) {
    var byReq = new Map();
    (rows || []).forEach(function (r) {
      var k = Number(r.requestId);
      if (!byReq.has(k)) {
        byReq.set(k, { requestId: k, requestNumber: r.requestNumber, lineIds: [], rows: [] });
      }
      var g = byReq.get(k);
      g.rows.push(r);
      // De-dupe: two units on the SAME line are two rows but one line to return.
      if (g.lineIds.indexOf(r.lineId) === -1) g.lineIds.push(r.lineId);
    });
    return Array.from(byReq.values());
  }

  /** Human label for a unit, whatever kind it is. '' when there is no unit. */
  function unitLabel(row) {
    if (!row) return '';
    return row.serialNumber || row.unitIdentifier || '';
  }

  return {
    MIN_QUERY_LENGTH:    MIN_QUERY_LENGTH,
    DEFAULT_PAGE_SIZE:   DEFAULT_PAGE_SIZE,
    RETURNABLE_STATUSES: RETURNABLE_STATUSES,
    findDeployedUnits:   findDeployedUnits,
    groupByRequest:      groupByRequest,
    unitLabel:           unitLabel
  };
});
