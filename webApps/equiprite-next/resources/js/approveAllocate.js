define([
  'resources/js/requestLineBody',
  'resources/js/requestDetailLines',
  'resources/js/lineDetailUnits',
  'resources/js/lineConfirmed',
  'resources/js/currentUser',
], function (lineBody, rdl, lineDetailUnits, lineConfirmed, cu) {
  'use strict';

  // Approve & allocate: every call it makes to EquipRite, in one place.
  //
  // The business rules are New EquipRite's (webApps/equiprite/flows/workbench/pages), carried over from Old:
  //   approve         approve-allocate confirmRequestChain (= Request detail's, = Old's)
  //   reject          approve-allocate rejectRequestChain (= Request detail's, = Old's)
  //   decideRequest   workbench bulkDecideChain, one request with every line in the pool
  //   loadUnits       approve-allocate openUnitsChain (the reads and the gates of a line's unit picker)
  //   saveAllocation  approve-allocate saveAllocationChain (old line-detail saveLineChain)
  // The calls, their order, their bodies and their guards are those chains', unchanged: statuses only move forward
  // from an allow-list, the header moves only once every line is decided, a line with a live Transfer Order cannot
  // change, the allocations and the line status are read again just before writing. What changed is the ending: the
  // chains toasted and reloaded; these return what happened, for the screen to say in words and read back.
  // tests/next-approvals.test.js runs New's chains and these side by side and compares every call.
  //
  // Added for Next: notifySentBack, the reason for sending a request back, to the requester (FDD S07, NTF-03).
  // Nothing here writes to Fusion.

  // confirmRequestChain
  var APPROVE_TARGET = 'IN_PROCESS';
  var HEADER_READY_STATES = ['IN_PROCESS', 'ALLOCATED', 'REJECTED'];
  var CASCADABLE = [null, '', 'DRAFT', 'SUBMITTED', 'IN_PROCESS'];
  // rejectRequestChain
  var REJECT_TARGET = 'REJECTED';
  var TERMINAL_STATES = ['REJECTED', 'CANCELLED', 'CLOSED', 'CONSUMED'];
  // saveAllocationChain
  var ALLOC_CASCADABLE = [null, '', 'DRAFT', 'SUBMITTED', 'IN_PROCESS', 'QUOTE_ACCEPTED'];
  // openUnitsChain
  var QUOTE_EXISTS = ['QUOTE_GENERATED', 'QUOTE_ACCEPTED', 'DEPLOYED'];

  function isHeaderReady(s) { return HEADER_READY_STATES.indexOf(String(s || '').toUpperCase()) !== -1; }
  function isTerminal(s) { return TERMINAL_STATES.indexOf(String(s || '').toUpperCase()) !== -1; }
  function toBoolY(v) { return (typeof v === 'boolean') ? v : (v || '').toString().toUpperCase() === 'Y'; }

  /**
   * A request's lines, as Approve & allocate's initChain builds them: views/request-detail-lines (size 10000, every
   * line in one page), each mapped by requestDetailLines.mapRow, plus the three names the approve and reject logic
   * reads (lineId, lineStatus, equipmentName). The raw rows come back too (the request's own fields are on each).
   * Not requestDetailLines.fetchAndBuild: its purchase-requisition enrichment can write (it moves a line with a PO to
   * DEPLOYED), and this screen never writes on opening.
   * @returns {Promise<{ ok, status, rows, lines }>}
   */
  async function loadLines(context, Actions, requestId) {
    var res = await Actions.callRest(context, {
      endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
      uriParams: { requestId: Number(requestId), size: 10000 }
    }).catch(function () { return null; });
    if (!res || !res.ok || !res.body || !Array.isArray(res.body.data)) {
      return { ok: false, status: res ? res.status : 0, rows: [], lines: [] };
    }
    var rows = res.body.data;
    var lines = rows.map(rdl.mapRow).map(function (l) {
      return Object.assign(l, {
        lineId:        String(l.line_id !== undefined && l.line_id !== null ? l.line_id : l.line_no),
        lineStatus:    l.line_status || '',
        equipmentName: l.equipment_name || ''
      });
    });
    return { ok: true, status: res.status, rows: rows, lines: lines };
  }

  /**
   * confirmRequestChain. pool: the ticked lines, or every line when none is ticked; allLines: every line.
   * @returns {Promise<{ ok, nothing?, message?, updated, skipped, headerMoved, headerFailed, updates }>}
   */
  async function approve(context, Actions, o) {
    var numericId = o.requestId;
    var pool = o.pool || [];
    var allLines = o.allLines || [];
    var targets = pool.filter(function (l) { return CASCADABLE.indexOf(l.lineStatus) !== -1; });
    var skipped = pool.length - targets.length;
    if (targets.length === 0) {
      return { ok: false, nothing: true, updated: 0, skipped: skipped, headerMoved: false, updates: [] };
    }

    // Allocation state, for the ALLOCATED shortcut: a fully allocated line skips IN_PROCESS.
    var allocById = {};
    try {
      var allocResult = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
        uriParams: { requestId: numericId, size: 2000 }
      });
      if (allocResult && allocResult.ok && allocResult.body && Array.isArray(allocResult.body.data)) {
        allocResult.body.data.forEach(function (r) { allocById[String(r.id)] = r.allocationStatus; });
      } else {
        console.warn('[approveAllocate] allocationStatus lookup non-OK:', allocResult && allocResult.status, '- defaulting to IN_PROCESS');
      }
    } catch (e) {
      console.warn('[approveAllocate] allocationStatus lookup failed:', e, '- defaulting to IN_PROCESS');
    }

    // One batch PATCH for every line (all or nothing).
    var updates = targets.map(function (l) {
      return { id: Number(l.lineId), lineStatus: (allocById[String(l.lineId)] === 'ALLOCATED') ? 'ALLOCATED' : APPROVE_TARGET };
    });
    var batch = await lineBody.updateLines(context, Actions, {
      requestId: numericId,
      headers:   cu.auditHeaders(context),
      updates:   updates,
      labels:    targets.map(function (l) { return l.equipmentName; })
    });
    if (!batch.ok) {
      return { ok: false, message: batch.message + ' No line was changed.', updated: 0, skipped: skipped, headerMoved: false, updates: updates };
    }
    var approvedStates = {};
    updates.forEach(function (u) { approvedStates[String(u.id)] = u.lineStatus; });
    var updated = updates.length;

    // Header rollup: SUBMITTED -> IN_PROCESS only once every line has settled.
    var headerMoved = false;
    var headerFailed = false;
    if (updated > 0) {
      var everyLineReady = allLines.length > 0 && allLines.every(function (l) {
        return isHeaderReady(approvedStates[String(l.lineId)] || l.lineStatus);
      });
      if (everyLineReady) {
        var headerResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/patchEquipmentRequest',
          uriParams: { id: numericId },
          body: { status: APPROVE_TARGET }
        }).catch(function (e) { return { ok: false, error: e }; });
        headerMoved = !!(headerResult && headerResult.ok);
        headerFailed = !headerMoved;
        if (!headerMoved) console.warn('[approveAllocate] header PATCH failed:', headerResult && headerResult.status);
      }
    }
    return { ok: true, updated: updated, skipped: skipped, headerMoved: headerMoved, headerFailed: headerFailed, updates: updates };
  }

  /**
   * rejectRequestChain. pool: the ticked lines, or every line; allLines: every line (for the header rollup).
   * @returns {Promise<{ ok, nothing?, message?, updated, skipped, requestRejected, headerFailed }>}
   */
  async function reject(context, Actions, o) {
    var numericId = o.requestId;
    var pool = o.pool || [];
    var allLines = o.allLines || [];
    var eligible = pool.filter(function (l) { return !isTerminal(l.lineStatus); });
    var skipped = pool.length - eligible.length;
    if (eligible.length === 0) {
      return { ok: false, nothing: true, updated: 0, skipped: skipped, requestRejected: false };
    }
    var batch = await lineBody.updateLines(context, Actions, {
      requestId: numericId,
      headers:   cu.auditHeaders(context),
      updates:   eligible.map(function (l) { return { id: Number(l.lineId), lineStatus: REJECT_TARGET }; }),
      labels:    eligible.map(function (l) { return l.equipmentName; })
    });
    if (!batch.ok) {
      return { ok: false, message: batch.message + ' No line was changed.', updated: 0, skipped: skipped, requestRejected: false };
    }
    var rejectedIds = {};
    eligible.forEach(function (l) { rejectedIds[String(l.lineId)] = true; });
    var updated = eligible.length;

    // Header rollup: the request is rejected only when nothing is left live.
    var requestRejected = false;
    var headerFailed = false;
    if (updated > 0) {
      var anyLive = allLines.some(function (l) { return !rejectedIds[String(l.lineId)] && !isTerminal(l.lineStatus); });
      if (!anyLive && allLines.length > 0) {
        var headerResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/patchEquipmentRequest',
          uriParams: { id: numericId },
          body: { status: REJECT_TARGET }
        }).catch(function (e) { return { ok: false, error: e }; });
        requestRejected = !!(headerResult && headerResult.ok);
        headerFailed = !requestRejected;
        if (!requestRejected) console.warn('[approveAllocate] header PATCH failed', headerResult && headerResult.status);
      }
    }
    return { ok: true, updated: updated, skipped: skipped, requestRejected: requestRejected, headerFailed: headerFailed };
  }

  /**
   * bulkDecideChain for one request: its lines (views/request-detail-lines), then approve or reject with every line
   * in the pool. A request whose lines cannot be read is not touched.
   * @returns {Promise<{ ok, skip?, message?, result?, lines }>}
   */
  async function decideRequest(context, Actions, action, requestId) {
    var res = await Actions.callRest(context, {
      endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
      uriParams: { requestId: Number(requestId), size: 10000 }
    }).catch(function () { return null; });
    if (!res || !res.ok || !res.body || !Array.isArray(res.body.data)) {
      return { ok: false, message: 'Its lines could not be read; nothing was changed.', lines: [] };
    }
    var lines = res.body.data.map(function (r, index) {
      return {
        lineId:        String(r.lineId !== undefined && r.lineId !== null ? r.lineId : index + 1),
        equipmentName: r.equipmentName || '',
        lineStatus:    r.lineStatus || ''
      };
    });
    if (!lines.length) {
      return { ok: false, message: 'Its lines could not be read; nothing was changed.', lines: [] };
    }
    var out;
    try {
      out = action === 'approve'
        ? await approve(context, Actions, { requestId: Number(requestId), pool: lines, allLines: lines })
        : await reject(context, Actions, { requestId: Number(requestId), pool: lines, allLines: lines });
    } catch (e) {
      return { ok: false, message: String((e && e.message) || e), lines: lines, first: res.body.data[0] || {} };
    }
    if (out.nothing) {
      return { ok: false, skip: true, result: out, lines: lines, first: res.body.data[0] || {},
        message: action === 'approve' ? 'No line on it can be approved.' : 'No line on it can be sent back.' };
    }
    return { ok: !!out.ok, result: out, message: out.message || '', lines: lines, first: res.body.data[0] || {} };
  }

  /**
   * The reads and the gates of a line's unit picker (openUnitsChain), for one line of a request whose allocation is
   * open: views/line-detail-units (every unit of the line's equipment with its availability over the line's dates,
   * and this line's allocations), transfer-orders (is this line confirmed? then it is read only) and, for the
   * schedule, views/line-detail-bookings (serial mode, when o.bookings). o.transferOrders reuses a list already read
   * for the same request (the suggestions read it once for every line); the save reads it again before writing.
   *   o: { requestId, line (a loadLines line), requestNumber, isExternal (fn(source) -> bool), quotingOn (fn(source) -> bool: ENABLE_QUOTES),
   *        readOnly, bookings, transferOrders }
   * @returns {Promise<{ error } | { resources, allocated, allocLine, mode, confirmed, readOnly, readOnlyWhy, bookings }>}
   */
  async function loadUnits(context, Actions, o) {
    var requestId = Number(o.requestId);
    var line = o.line || {};
    var lineId = line.line_id;
    var settled = await Promise.allSettled([
      Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1ViewsLineDetailUnits',
        uriParams: { requestId: requestId, lineId: Number(lineId), size: 10000 }
      }),
      o.transferOrders ? Promise.resolve({ ok: true, body: { data: o.transferOrders } }) : Actions.callRest(context, {
        endpoint:  'eqp-v1/getTransferOrders',
        uriParams: { equipmentRequestId: requestId }
      })
    ]);
    var detailResp = settled[0].status === 'fulfilled' ? settled[0].value : null;
    var toResp     = settled[1].status === 'fulfilled' ? settled[1].value : null;
    var detailRows = (detailResp && detailResp.ok && detailResp.body && Array.isArray(detailResp.body.data)) ? detailResp.body.data : [];
    var detailRow = detailRows.find(function (r) { return String(r.lineId) === String(lineId); });
    if (!detailResp || !detailResp.ok) {
      return { error: 'Its units could not be read (HTTP ' + (detailResp && detailResp.status) + ').' };
    }
    if (!detailRow) {
      return { error: 'No serial numbers, lots or stock items are registered for ' + (line.equipment_name || 'this equipment') + '.' };
    }

    // Gates (old vbEnterChain): customer line at UNDER_PROCUREMENT is read only; SUBMITTED or quote owed is closed.
    var isCustomerSource = !!o.isExternal(detailRow.source);
    var pickerReadOnly = isCustomerSource && String(detailRow.lineStatus || '').toUpperCase() === 'UNDER_PROCUREMENT';
    var gateStatus = String(detailRow.requestStatus || '').toUpperCase();
    var quoteExists = QUOTE_EXISTS.indexOf(gateStatus) !== -1;
    var quotingOn = !!o.quotingOn(detailRow.source);
    var quoteOwed = quotingOn && !quoteExists;
    if ((gateStatus === 'SUBMITTED' || quoteOwed) && !pickerReadOnly) {
      return { error: gateStatus === 'SUBMITTED' ? 'Units can be assigned once the request is approved.' : 'Units can be assigned once the quote is generated.' };
    }

    // Mode: serial, then lot, then inventory (serial when the flag is missing).
    var isLotCtrl    = toBoolY(detailRow.isLotControlled);
    var isSerialCtrl = (detailRow.isSerialControlled != null) ? toBoolY(detailRow.isSerialControlled) : true;
    var isInvTracked = toBoolY(detailRow.isInventoryTracked);
    var mode;
    if (isSerialCtrl)      mode = 'serial';
    else if (isLotCtrl)    mode = 'lot';
    else if (isInvTracked) mode = 'inventory';
    else                   mode = 'serial';

    var day = function (iso) { return iso ? String(iso).slice(0, 10) : ''; };
    var eqpMasterId = detailRow.equipmentMasterId || line.equipment_master_id;
    var eqpInfo = { equipmentName: detailRow.equipmentName || '', className: detailRow.className || '' };
    var allocLine = {
      line_id:             detailRow.lineId,
      line_no:             line.line_no,
      equipment_master_id: eqpMasterId,
      equipment_name:      eqpInfo.equipmentName,
      class:               eqpInfo.className,
      qty:                 detailRow.quantity || 1,
      alloc_status:        detailRow.allocStatus || 'PENDING',
      start_date:          day(detailRow.lineStartDate || detailRow.startDate),
      end_date:            day(detailRow.lineEndDate || detailRow.endDate),
      line_status:         detailRow.lineStatus || '',
      source:              detailRow.source || '',
      quoting_on:          quotingOn === true,
      request_number:      detailRow.requestNumber || o.requestNumber || ''
    };

    var tos = (toResp && toResp.ok && toResp.body && toResp.body.data) || [];
    var confirmed = await lineConfirmed.lineIsConfirmed(context, Actions, tos, lineId);
    var built = lineDetailUnits.buildResources(detailRows, mode, eqpInfo, eqpMasterId);

    var bookingRows = [];
    if (o.bookings && mode === 'serial' && eqpMasterId) {
      try {
        var bookingsResp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsLineDetailBookings',
          uriParams: { equipmentMasterId: Number(eqpMasterId), size: 10000 }
        });
        if (bookingsResp && bookingsResp.ok && bookingsResp.body && Array.isArray(bookingsResp.body.data)) bookingRows = bookingsResp.body.data;
      } catch (e) {
        console.warn('[approveAllocate] line-detail-bookings fetch failed:', e);
      }
    }
    var readOnly = pickerReadOnly || !!o.readOnly;
    return {
      resources: built.resources,
      allocated: built.allocated,
      allocLine: allocLine,
      mode: mode,
      confirmed: !!confirmed,
      readOnly: readOnly,
      readOnlyWhy: confirmed ? 'A Transfer Order is live for this line: its units can no longer change.'
        : (pickerReadOnly ? 'This customer line is being bought in: view only.' : (o.readOnly ? 'Read only: assigning units needs full Approve & allocate access.' : '')),
      bookings: bookingRows,
      empty: built.resources.length ? '' : 'No ' + (mode === 'lot' ? 'lots' : (mode === 'inventory' ? 'stock items' : 'serial numbers'))
        + ' are registered for ' + (eqpInfo.equipmentName || 'this equipment') + '.'
    };
  }

  // Denormalize the allocated unit's inventory org onto the allocation row (old orgFields).
  function orgFields(assn) {
    if (!assn || assn.invOrgId == null) return {};
    return { eqpInvOrgId: Number(assn.invOrgId), eqpInvOrgName: assn.invOrgName || '' };
  }

  /**
   * saveAllocationChain.save: writes the staged changes of one line.
   *   0. gate     getTransferOrders (+ getTransferOrderLines): a line with a live Transfer Order is confirmed; nothing changes
   *   0b. stale   getAllocations (and the lines, when the line already has its quantity)
   *   1. releases patchAllocation RELEASED, then serial patchSerialRef AVAILABLE | lot / inventory ATR + qty
   *   2. assigns  createAllocation, then serial patchSerialRef RENTED | lot / inventory ATR − qty
   *   3. recount  views/line-detail-units, then patchRequestLine allocationStatus PENDING | PARTIAL | ALLOCATED, with
   *               lineStatus ALLOCATED on full allocation from a pre-allocation status, or back to IN_PROCESS
   *               (QUOTE_ACCEPTED when quoted) when the last unit is released from an ALLOCATED line
   *   o: { requestId, lineData (loadUnits().allocLine), staged (Picker.getStagedChanges()) }
   * @returns {Promise<{ ok, confirmed?, nothing?, errors, lineError, total, mode, allocationStatus, lineStatus, allocated }>}
   */
  async function saveAllocation(context, Actions, o) {
    var requestId = o.requestId;
    var lineData = o.lineData;
    var lineId = lineData.line_id;
    var staged = o.staged || {};
    var pendingAssignments = staged.pendingAssignments || [];
    var pendingReleases    = staged.pendingReleases    || [];
    if (!pendingAssignments.length && !pendingReleases.length) {
      return { ok: false, nothing: true, errors: [], lineError: '', total: 0 };
    }

    // ── Allocation gate: has this line been confirmed (a live Transfer Order)? Fails open on a lookup error. ──
    var lineIsConfirmedNow = false;
    try {
      var toResp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getTransferOrders',
        uriParams: { equipmentRequestId: Number(requestId) }
      });
      var tos = (toResp && toResp.ok && toResp.body && toResp.body.data) || [];
      lineIsConfirmedNow = await lineConfirmed.lineIsConfirmed(context, Actions, tos, lineId);
    } catch (e) {
      console.warn('[approveAllocate] confirmed-check failed — treating as unconfirmed:', e);
      lineIsConfirmedNow = false;
    }
    if (lineIsConfirmedNow) {
      return { ok: false, confirmed: true, errors: [], lineError: '', total: 0 };
    }

    var preAllocStatusFor = function () { return lineData.quoting_on ? 'QUOTE_ACCEPTED' : 'IN_PROCESS'; };

    var knownLineStatus;
    var knownLineStatusFetched = false;
    var readCurrentLineStatus = async function () {
      if (knownLineStatusFetched) return knownLineStatus;
      try {
        var cur = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
          uriParams: { requestId: Number(requestId), size: 2000 }
        });
        if (cur && cur.ok && cur.body && Array.isArray(cur.body.data)) {
          var row = cur.body.data.find(function (l) { return Number(l.id) === Number(lineId); });
          if (row) {
            knownLineStatus        = row.lineStatus;
            knownLineStatusFetched = true;
            return row.lineStatus;
          }
        }
      } catch (e) {
        console.warn('[approveAllocate] failed to fetch current lineStatus:', e);
      }
      return null;
    };

    // ── Stale check: active allocations, and the line's status when it has its quantity ──
    try {
      var lineQty0 = lineData.qty || 1;
      var allocResp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getAllocations',
        uriParams: { requestLineId: Number(lineId) }
      });
      var activeList = (allocResp && allocResp.ok)
        ? ((allocResp.body && allocResp.body.data) || []).filter(function (a) { return (a.allocationStatus || '').toUpperCase() !== 'RELEASED'; })
        : [];
      if (activeList.length >= lineQty0) {
        var linesResp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
          uriParams: { requestId: Number(requestId), size: 2000 }
        });
        if (linesResp && linesResp.ok && linesResp.body && Array.isArray(linesResp.body.data)) {
          var row0 = linesResp.body.data.find(function (l) { return Number(l.id) === Number(lineId); });
          knownLineStatus = row0 ? row0.lineStatus : null;
          knownLineStatusFetched = true;
        }
      }
    } catch (e) {
      console.warn('[approveAllocate] stale-check failed (will fall through):', e);
    }

    var today  = new Date().toISOString();
    var errors = [];
    var stagedMode = staged.mode || null;
    var sample = pendingAssignments[0] || pendingReleases[0] || null;
    var shapeIsQty = sample && sample.qty != null;
    var isLotMode = (stagedMode === 'lot') || (!stagedMode && shapeIsQty);
    var isInventoryMode = (stagedMode === 'inventory');
    var i;

    // ── 1. Releases first (free up before re-allocating) ──
    for (i = 0; i < pendingReleases.length; i++) {
      var rel = pendingReleases[i];
      try {
        var r1 = await Actions.callRest(context, {
          endpoint:  'eqp-v1/patchAllocation',
          uriParams: { id: Number(rel.allocationId) },
          body: { allocationStatus: 'RELEASED', releasedDate: today }
        });
        if (!r1 || !r1.ok) {
          errors.push('Release allocation ' + rel.allocationId + ' failed (HTTP ' + ((r1 && r1.status) || '?') + ')');
          continue;
        }
        if (isLotMode) {
          var releasedQty = Number(rel.qty || 0);
          if (releasedQty > 0 && rel.eqrLotRefId != null) {
            var curAtr = null;
            try {
              var lotGet = await Actions.callRest(context, { endpoint: 'eqp-v1/getLotRefById', uriParams: { id: Number(rel.eqrLotRefId) } });
              if (lotGet && lotGet.ok && lotGet.body && lotGet.body.availableToReserve != null) curAtr = Number(lotGet.body.availableToReserve);
            } catch (e) { /* tolerate; skip the patch */ }
            if (curAtr != null) {
              var r2 = await Actions.callRest(context, {
                endpoint:  'eqp-v1/patchLotRef',
                uriParams: { id: Number(rel.eqrLotRefId) },
                body: { availableToReserve: curAtr + releasedQty }
              });
              if (!r2 || !r2.ok) errors.push('Return lot ' + rel.lotNumber + ' to ATR failed (HTTP ' + ((r2 && r2.status) || '?') + ')');
            }
          }
        } else if (isInventoryMode) {
          var releasedQtyI = Number(rel.qty || rel.allocatedQty || 0);
          var invRefIdR    = Number(rel.inventoryItemRefId);
          if (releasedQtyI > 0 && invRefIdR) {
            var curAtrI = null;
            try {
              var invGet = await Actions.callRest(context, { endpoint: 'eqp-v1/getInventoryItemRefById', uriParams: { id: invRefIdR } });
              if (invGet && invGet.ok && invGet.body && invGet.body.availableToReserve != null) curAtrI = Number(invGet.body.availableToReserve);
            } catch (e) { /* tolerate; skip the patch */ }
            if (curAtrI != null) {
              var r2i = await Actions.callRest(context, {
                endpoint:  'eqp-v1/patchInventoryItemRef',
                uriParams: { id: invRefIdR },
                body: { availableToReserve: curAtrI + releasedQtyI }
              });
              if (!r2i || !r2i.ok) errors.push('Return inventory ' + (rel.itemNumber || rel.lotNumber || invRefIdR) + ' to ATR failed (HTTP ' + ((r2i && r2i.status) || '?') + ')');
            }
          }
        } else if (rel.eqrSerialRefId != null) {
          var ru = await Actions.callRest(context, {
            endpoint:  'eqp-v1/patchSerialRef',
            uriParams: { id: Number(rel.eqrSerialRefId) },
            body: { unitStatus: 'AVAILABLE' }
          });
          if (!ru || !ru.ok) errors.push('Release unit ' + rel.serialNumber + ' failed (HTTP ' + ((ru && ru.status) || '?') + ')');
        }
      } catch (e) {
        errors.push('Release error for ' + (rel.serialNumber || rel.lotNumber) + ': ' + ((e && e.message) || e));
      }
    }

    // ── 2. New assignments ──
    for (i = 0; i < pendingAssignments.length; i++) {
      var assn = pendingAssignments[i];
      try {
        if (isLotMode) {
          var assnQty = Math.max(1, Number(assn.qty || 0));
          var c1 = await Actions.callRest(context, {
            endpoint: 'eqp-v1/createAllocation',
            body: Object.assign({
              requestLineId:    Number(lineId),
              lotRefId:         Number(assn.eqrLotRefId),
              allocatedQty:     assnQty,
              allocationStatus: 'ALLOCATED',
              allocatedDate:    today
            }, orgFields(assn))
          });
          if (!c1 || !c1.ok) {
            errors.push('Create lot allocation for ' + assn.lotNumber + ' failed (HTTP ' + ((c1 && c1.status) || '?') + ')');
            continue;
          }
          var curAtrL = null;
          try {
            var lotGetA = await Actions.callRest(context, { endpoint: 'eqp-v1/getLotRefById', uriParams: { id: Number(assn.eqrLotRefId) } });
            if (lotGetA && lotGetA.ok && lotGetA.body && lotGetA.body.availableToReserve != null) curAtrL = Number(lotGetA.body.availableToReserve);
          } catch (e) { /* tolerate */ }
          if (curAtrL != null) {
            var c2 = await Actions.callRest(context, {
              endpoint:  'eqp-v1/patchLotRef',
              uriParams: { id: Number(assn.eqrLotRefId) },
              body: { availableToReserve: Math.max(0, curAtrL - assnQty) }
            });
            if (!c2 || !c2.ok) errors.push('Reserve lot ' + assn.lotNumber + ' from ATR failed (HTTP ' + ((c2 && c2.status) || '?') + ')');
          }
        } else if (isInventoryMode) {
          var assnQtyI = Math.max(1, Number(assn.qty || 0));
          var invRefId = Number(assn.inventoryItemRefId);
          var c1i = await Actions.callRest(context, {
            endpoint: 'eqp-v1/createAllocation',
            body: Object.assign({
              requestLineId:      Number(lineId),
              inventoryItemRefId: invRefId,
              allocatedQty:       assnQtyI,
              allocationStatus:   'ALLOCATED',
              allocatedDate:      today
            }, orgFields(assn))
          });
          if (!c1i || !c1i.ok) {
            errors.push('Create inventory allocation for ' + (assn.itemNumber || assn.lotNumber || ('item ' + invRefId)) + ' failed (HTTP ' + ((c1i && c1i.status) || '?') + ')');
            continue;
          }
          var curAtrA = null;
          try {
            var invGetA = await Actions.callRest(context, { endpoint: 'eqp-v1/getInventoryItemRefById', uriParams: { id: invRefId } });
            if (invGetA && invGetA.ok && invGetA.body && invGetA.body.availableToReserve != null) curAtrA = Number(invGetA.body.availableToReserve);
          } catch (e) { /* tolerate */ }
          if (curAtrA != null) {
            var c2i = await Actions.callRest(context, {
              endpoint:  'eqp-v1/patchInventoryItemRef',
              uriParams: { id: invRefId },
              body: { availableToReserve: Math.max(0, curAtrA - assnQtyI) }
            });
            if (!c2i || !c2i.ok) errors.push('Reserve inventory ' + (assn.itemNumber || assn.lotNumber || invRefId) + ' from ATR failed (HTTP ' + ((c2i && c2i.status) || '?') + ')');
          }
        } else {
          var c1s = await Actions.callRest(context, {
            endpoint: 'eqp-v1/createAllocation',
            body: Object.assign({
              requestLineId:    Number(lineId),
              serialRefId:      Number(assn.eqrSerialRefId),
              allocatedQty:     1,
              allocationStatus: 'ALLOCATED',
              allocatedDate:    today
            }, orgFields(assn))
          });
          if (!c1s || !c1s.ok) {
            errors.push('Create allocation for ' + assn.serialNumber + ' failed (HTTP ' + ((c1s && c1s.status) || '?') + ')');
            continue;
          }
          var rus = await Actions.callRest(context, {
            endpoint:  'eqp-v1/patchSerialRef',
            uriParams: { id: Number(assn.eqrSerialRefId) },
            body: { unitStatus: 'RENTED' }
          });
          if (!rus || !rus.ok) errors.push('Set unit ' + assn.serialNumber + ' RENTED failed (HTTP ' + ((rus && rus.status) || '?') + ')');
        }
      } catch (e) {
        errors.push('Assignment error for ' + (assn.serialNumber || assn.lotNumber) + ': ' + ((e && e.message) || e));
      }
    }

    // ── 3. Recount from line-detail-units and PATCH the line's allocationStatus ──
    var mode = isLotMode ? 'lot' : (isInventoryMode ? 'inventory' : 'serial');
    var allocatedNow = [];
    try {
      var unitsResp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1ViewsLineDetailUnits',
        uriParams: { requestId: Number(requestId), lineId: Number(lineId), size: 10000 }
      });
      if (unitsResp && unitsResp.ok && unitsResp.body && Array.isArray(unitsResp.body.data)) {
        allocatedNow = lineDetailUnits.buildResources(unitsResp.body.data, mode,
          { equipmentName: lineData.equipment_name || '', className: lineData.class || '' },
          lineData.equipment_master_id).allocated;
      }
    } catch (e) { /* tolerate */ }

    var lineError = '';
    var newLineStatus = '';
    var body = {};
    var allocatedUnits = 0;
    try {
      var lineQty = lineData.qty || 1;
      allocatedUnits = mode === 'serial'
        ? allocatedNow.length
        : allocatedNow.reduce(function (sum, a) { return sum + Number(a.allocatedQty || 0); }, 0);
      if (allocatedUnits === 0)           newLineStatus = 'PENDING';
      else if (allocatedUnits >= lineQty) newLineStatus = 'ALLOCATED';
      else                                newLineStatus = 'PARTIAL';

      body = { allocationStatus: newLineStatus };
      if (newLineStatus === 'ALLOCATED') {
        var currentLineStatus = await readCurrentLineStatus();
        if (ALLOC_CASCADABLE.indexOf(currentLineStatus) !== -1) body.lineStatus = 'ALLOCATED';
      } else if (newLineStatus === 'PENDING') {
        // Demote on full release, only from ALLOCATED (a released line must be allocatable again).
        var currentLineStatus2 = await readCurrentLineStatus();
        if (String(currentLineStatus2 || '').toUpperCase() === 'ALLOCATED') body.lineStatus = preAllocStatusFor();
      }
      var lineStatusResp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/patchRequestLine',
        uriParams: { requestId: Number(requestId), id: Number(lineId) },
        body:      body
      });
      if (!lineStatusResp || !lineStatusResp.ok) {
        lineError = 'The line\'s allocation status was not updated (HTTP ' + (lineStatusResp && lineStatusResp.status) + ').';
        console.warn('[approveAllocate] PATCH request-line status failed', lineStatusResp && lineStatusResp.status);
      }
    } catch (e) {
      console.warn('[approveAllocate] PATCH line status threw:', e);
    }

    return {
      ok: !errors.length && !lineError,
      errors: errors,
      lineError: lineError,
      total: pendingAssignments.length + pendingReleases.length,
      mode: mode,
      allocationStatus: newLineStatus,
      lineStatus: body.lineStatus || '',
      allocated: allocatedUnits
    };
  }

  /**
   * Added for Next (FDD S07, NTF-03 "Request rejected (with reason)"): the reason for sending a request back, as an
   * in-app notification to its requester, in the fields the bell reads (alerts.fromServer). Written after the send
   * back succeeded, never instead of it. Without a requester user id nothing is sent.
   *   o: { userId, requestId, requestNumber, reason, lines (count sent back), whole (the request itself was sent back) }
   * @returns {Promise<{ ok, skipped?, status? }>}
   */
  async function notifySentBack(context, Actions, o) {
    var userId = o.userId != null && o.userId !== '' && !isNaN(Number(o.userId)) ? Number(o.userId) : null;
    if (userId == null) return { ok: false, skipped: true };
    var res = await Actions.callRest(context, {
      endpoint: 'eqp-v1/createNotification',
      headers: cu.auditHeaders(context),
      body: {
        userId: userId,
        requestId: Number(o.requestId),
        requestNumber: o.requestNumber || '',
        subject: (o.requestNumber || 'Your request') + (o.whole ? ' was sent back' : ': ' + o.lines + (o.lines === 1 ? ' line was' : ' lines were') + ' sent back'),
        message: String(o.reason || '').trim()
      }
    }).catch(function (e) { return { ok: false, status: 0, error: e }; });
    return { ok: !!(res && res.ok), status: res ? res.status : 0 };
  }

  return {
    loadLines: loadLines,
    approve: approve,
    reject: reject,
    decideRequest: decideRequest,
    loadUnits: loadUnits,
    saveAllocation: saveAllocation,
    notifySentBack: notifySentBack,
    CASCADABLE: CASCADABLE,
    TERMINAL_STATES: TERMINAL_STATES,
    HEADER_READY_STATES: HEADER_READY_STATES
  };
});
