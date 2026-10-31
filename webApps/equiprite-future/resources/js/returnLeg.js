define([], function () {
  'use strict';

  /**
   * RETURN LEG — the inbound Transfer Order sequence, in ONE place.
   *
   * Extracted from request-detail-page's processReturn so the Direct Return
   * path can reuse it rather than carry a second copy. This project already has
   * four near-duplicate release chains kept in sync by comments telling readers
   * to keep them in sync; that has not held, and a return leg is a far worse
   * thing to have drift than a release.
   *
   * The sequence, per route:
   *
   *   1. plan     POST /returns/plan      -> routes + blocks (server authoritative)
   *   2. reserve  POST /returns/reserve   -> closes the duplicate-TO window
   *   3. OIC      POST createSupplyRequest (OrderType INBOUND) -> 202 Accepted
   *   4a. ok      POST /returns/record    -> RETURN_IN_PROCESS, one transaction
   *   4b. fail    POST /returns/release-reservation -> frees the lines now
   *
   * ── NO BLOCK-ALL ON THE RETURN LEG ─────────────────────────────────────────
   * The OUTBOUND leg refuses everything if any line is blocked, because
   * shipping some lines while silently skipping one is the bug. The return is
   * the OPPOSITE: refusing the whole return because one line lost its yard
   * stamp would STRAND REAL EQUIPMENT ON SITE. Blocked lines are named and
   * skipped; the resolvable ones still travel.
   *
   * ── ROUTES ARE KEYED (source|dest), NOT BY SOURCE ──────────────────────────
   * On a return the source is usually the single virtual org, so bucketing by
   * source alone would collapse every line into one Transfer Order. Keying on
   * the pair splits them, so equipment goes back to the yard it came from.
   */

  // OIC supply-request constants. Mirrors PAYLOAD_DEFAULTS in request-detail's
  // ActionChain. Deliberately NO SourceOrganizationCode / DestinationOrganizationCode
  // defaults: both are resolved per line, and a '001'/'002' fallback once
  // silently created Transfer Orders moving equipment from yards it was never
  // allocated in. Do not reintroduce them.
  var PAYLOAD_DEFAULTS = {
    InterfaceSourceCode:         'EXT',
    SupplyOrderSource:           'EXT',
    SupplyRequestStatus:         'NEW',
    ProcessRequestFlag:          'Y',
    DestinationSubinventoryCode: 'Stores',
    UOMCode:                     'zzu',
    BackToBackFlag:              'N',
    SupplyType:                  'TRANSFER',
    SupplyOperation:             'CREATE',
    DestinationTypeCode:         'INVENTORY',
    PreparerId:                  300000047340498,
    DeliverToRequesterId:        300000047340498
  };

  /**
   * Ask the package which routes a return WOULD take.
   * Returns { ok, routes, blocks, fAndMLineIds }. fAndMLineIds are lines the
   * server says return WITHOUT a Transfer Order (status only, /returns/record). `ok:false` means the caller should fall
   * back to its own resolution (request-detail has one; Direct Return does not,
   * and treats it as a hard failure).
   */
  async function planReturn(context, Actions, requestId, lineIds) {
    try {
      var r = await Actions.callRest(context, {
        endpoint:  'eqp-v1/planReturn',
        uriParams: { requestId: Number(requestId) },
        body:      { lineIds: lineIds.map(Number) }
      });
      if (!r || !r.ok) {
        console.warn('[returnLeg] /returns/plan not ok (HTTP ' + (r && r.status) + ')');
        return { ok: false, routes: [], blocks: [], fAndMLineIds: [] };
      }
      var b = r.body || {};
      return { ok: true, routes: b.buckets || [], blocks: b.blocks || [],
               fAndMLineIds: (b.fAndMLineIds || []).map(Number) };
    } catch (e) {
      console.warn('[returnLeg] /returns/plan threw:', e);
      return { ok: false, routes: [], blocks: [], fAndMLineIds: [] };
    }
  }

  /**
   * Reserve one route's lines before the OIC call.
   *
   * leg='INBOUND' keeps this clear of any outbound reservation on the same
   * line: the unique index is (request_line_id, leg) while PENDING, so both
   * legs coexist.
   *
   * A reserve OUTAGE does not block the return — an outage of the safety net
   * must not read as an outage of the feature. It degrades to unreserved.
   */
  async function reserveRoute(context, Actions, requestId, lineIds, batchNumber, idempotencyKey, headers) {
    try {
      var r = await Actions.callRest(context, {
        endpoint:  'eqp-v1/reserveReturn',
        uriParams: { requestId: Number(requestId) },
        headers:   headers || {},
        body:      { lineIds: lineIds.map(Number), batchNumber: batchNumber,
                     idempotencyKey: idempotencyKey, leg: 'INBOUND' }
      });
      if (!r || !r.ok) {
        console.warn('[returnLeg] reserve not ok (HTTP ' + (r && r.status) + ') — proceeding unreserved');
        return { proceed: true, replayed: false, rejected: [] };
      }
      var b = r.body || {};
      return {
        proceed:  b.replayed !== true && (b.reservedLineIds || []).length > 0,
        replayed: b.replayed === true,
        rejected: b.rejectedLineIds || []
      };
    } catch (e) {
      console.warn('[returnLeg] reserve threw — proceeding unreserved:', e);
      return { proceed: true, replayed: false, rejected: [] };
    }
  }

  /** Build the inbound OIC supply request for one route. */
  function buildOicBody(requestId, batchNumber, items, nowIso) {
    var refLine = 0;
    return {
      InterfaceSourceCode:        PAYLOAD_DEFAULTS.InterfaceSourceCode,
      InterfaceBatchNumber:       batchNumber,
      SupplyRequestStatus:        PAYLOAD_DEFAULTS.SupplyRequestStatus,
      SupplyRequestDate:          nowIso,
      SupplyOrderSource:          PAYLOAD_DEFAULTS.SupplyOrderSource,
      SupplyOrderReferenceNumber: batchNumber,
      SupplyOrderReferenceId:     null,
      ProcessRequestFlag:         PAYLOAD_DEFAULTS.ProcessRequestFlag,
      equipmentRequestId:         Number(requestId),
      // Tags the EQR_TRANSFER_ORDER row as the inbound leg. The OIC OrderType
      // mapping has shipped — 21 INBOUND rows recorded — so this is honoured.
      OrderType:                  'INBOUND',
      supplyRequestLines: items.map(function (item) {
        refLine++;
        return {
          InterfaceBatchNumber:           batchNumber,
          InterfaceSourceCode:            PAYLOAD_DEFAULTS.InterfaceSourceCode,
          SupplyOrderSource:              PAYLOAD_DEFAULTS.SupplyOrderSource,
          SupplyOrderReferenceLineNumber: String(refLine),
          SupplyOrderReferenceLineId:     refLine,
          // The return travels the outbound leg BACKWARDS: its source is the
          // outbound destination (the virtual org the equipment was deployed
          // to) and its destination is the outbound source (the yard it came
          // from). Resolved per line by the package, never defaulted.
          SourceOrganizationCode:         item.srcCode,
          DestinationOrganizationCode:    item.destCode,
          DestinationSubinventoryCode:    PAYLOAD_DEFAULTS.DestinationSubinventoryCode,
          ItemNumber:                     item.itemNumber,
          Quantity:                       item.qty || 1,
          UOMCode:                        PAYLOAD_DEFAULTS.UOMCode,
          BackToBackFlag:                 PAYLOAD_DEFAULTS.BackToBackFlag,
          NeedByDate:                     nowIso,
          PreparerId:                     PAYLOAD_DEFAULTS.PreparerId,
          DeliverToRequesterId:           PAYLOAD_DEFAULTS.DeliverToRequesterId,
          SupplyType:                     PAYLOAD_DEFAULTS.SupplyType,
          SupplyOperation:                PAYLOAD_DEFAULTS.SupplyOperation,
          DestinationTypeCode:            PAYLOAD_DEFAULTS.DestinationTypeCode,
          requestLineId:                  Number(item.lineId)
        };
      })
    };
  }

  /**
   * Hand a route's reservations back after its OIC call failed, so the lines
   * are returnable again immediately rather than waiting out the 15-minute TTL.
   * Best-effort and never throws: the return has already failed and a failed
   * cleanup must not mask that with a second, more confusing error.
   */
  async function releaseRoute(context, Actions, requestId, batchNumber, headers) {
    try {
      await Actions.callRest(context, {
        endpoint:  'eqp-v1/releaseReturnReservation',
        uriParams: { requestId: Number(requestId) },
        headers:   headers || {},
        body:      { batchNumber: batchNumber }
      });
    } catch (e) {
      console.warn('[returnLeg] release-reservation failed for ' + batchNumber + ' (will age out):', e);
    }
  }

  /**
   * Promote the returned lines. One transaction, both classes — record_return
   * treats S&T and F&M identically, which is why /returns/plan always reports
   * fAndMLineIds as [].
   *
   * batchNumber is deliberately NOT sent: it is optional on this endpoint and
   * record_return neither consumes nor settles one. Inventing a value that gets
   * discarded is the theatre the outbound '-FM' suffix exists to work around.
   */
  async function recordReturn(context, Actions, requestId, lineIds, headers) {
    try {
      var r = await Actions.callRest(context, {
        endpoint:  'eqp-v1/recordReturn',
        uriParams: { requestId: Number(requestId) },
        headers:   headers || {},
        body:      { lineIds: lineIds.map(Number) }
      });
      if (r && r.ok) {
        return { ok: true, linesPromoted: (r.body && r.body.linesPromoted) || 0 };
      }
      console.warn('[returnLeg] /returns/record not ok (HTTP ' + (r && r.status) + ')');
      return { ok: false, linesPromoted: 0 };
    } catch (e) {
      console.warn('[returnLeg] /returns/record threw:', e);
      return { ok: false, linesPromoted: 0 };
    }
  }

  /**
   * Roll a FAILED return back to DEPLOYED so it can be retried.
   *
   * Only for lines the server flagged (needsReturnResetLineIds) — a line whose
   * return actually succeeded is also RETURN_IN_PROCESS and must NOT be reset.
   * A 409 means exactly that: an inbound TO succeeded and the equipment is
   * genuinely in transit. Its message is written to be read, so surface it.
   */
  async function resetFailedReturn(context, Actions, requestId, lineIds, headers) {
    try {
      var r = await Actions.callRest(context, {
        endpoint:  'eqp-v1/resetFailedReturn',
        uriParams: { requestId: Number(requestId) },
        headers:   headers || {},
        body:      { lineIds: lineIds.map(Number) }
      });
      if (r && r.ok) return { ok: true, linesReset: (r.body && r.body.linesReset) || 0 };
      return {
        ok: false,
        status: r && r.status,
        message: (r && r.body && (r.body.detail || r.body.message)) || ''
      };
    } catch (e) {
      console.warn('[returnLeg] /returns/reset threw:', e);
      return { ok: false, status: 0, message: '' };
    }
  }

  /** 'EQR-RET-<request>-<epoch>' — the shape downstream matching depends on. */
  function baseBatchFor(requestNumberOrId) {
    return 'EQR-RET-' + requestNumberOrId + '-' + Date.now();
  }

  return {
    PAYLOAD_DEFAULTS:  PAYLOAD_DEFAULTS,
    planReturn:        planReturn,
    reserveRoute:      reserveRoute,
    buildOicBody:      buildOicBody,
    releaseRoute:      releaseRoute,
    recordReturn:      recordReturn,
    resetFailedReturn: resetFailedReturn,
    baseBatchFor:      baseBatchFor
  };
});
