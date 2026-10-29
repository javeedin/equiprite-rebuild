define([], function() {
  'use strict';

  // Statuses past which a TO is no longer release-eligible. Shared by every
  // page that lists/filters transfer orders (initiate-picking-page's dropdown,
  // request-detail-page's ship-confirm lookup) so the vocabulary stays in sync.
  const POST_RELEASE_STATUSES = ['CANCELLED', 'CANCELED', 'CLOSED', 'RELEASED', 'SHIPPED'];

  function isReleasable(orderStatus) {
    return POST_RELEASE_STATUSES.indexOf(String(orderStatus || '').toUpperCase()) === -1;
  }

  // Fusion's "already released" fingerprint: after a TO is released, its
  // pickWaves endpoint returns 400 because the (OrderNumber, OrderTypeCode,
  // SourceSystemName) triple no longer uniquely resolves to a releasable
  // wave. OIC surfaces this as HTTP 500 with the nested 400 body. Both the
  // outbound (ReleaseTransferOrderChain) and inbound (request-detail
  // ActionChain shipConfirm) release paths treat this as a soft warning
  // instead of a hard failure.
  const ALREADY_RELEASED_FINGERPRINT = 'OrderNumber, OrderTypeCode, SourceSystemName';

  // POSTs ics/releaseTO for one TO. Never throws — network and
  // HTTP errors are folded into the 'failed' outcome so callers can always
  // just branch on `outcome`.
  // Returns { outcome: 'released' | 'alreadyReleased' | 'failed', message }.
  async function releaseTransferOrder(context, Actions, toNumber, sourceOrg) {
    let oicResp;
    try {
      oicResp = await Actions.callRest(context, {
        endpoint: 'ics/releaseTO',
        body: { toNumber: toNumber, sourceOrg: sourceOrg }
      });
    } catch (e) {
      console.error('[releaseTransferOrder] OIC releaseTO threw for', toNumber, e);
      return { outcome: 'failed', message: 'Network error contacting Integration Cloud.' };
    }

    if (oicResp && oicResp.ok) {
      return { outcome: 'released', message: '' };
    }

    const bodyStr = (oicResp && oicResp.body)
      ? (typeof oicResp.body === 'string' ? oicResp.body : JSON.stringify(oicResp.body))
      : '';

    if (bodyStr.indexOf(ALREADY_RELEASED_FINGERPRINT) !== -1) {
      return { outcome: 'alreadyReleased', message: 'Transfer Order ' + toNumber + ' has already been released.' };
    }

    const serverMsg = (oicResp && oicResp.body && oicResp.body.message) || bodyStr;
    return {
      outcome: 'failed',
      message: serverMsg
        ? ('HTTP ' + oicResp.status + ': ' + serverMsg)
        : ('OIC rejected the release (HTTP ' + (oicResp && oicResp.status) + ').')
    };
  }

  // Maps one entry of the batch endpoint's results[] onto the same
  // { outcome, message } shape releaseTransferOrder returns, so callers can
  // branch on `outcome` regardless of which endpoint produced the result.
  // `reachedStage` rides alongside `outcome` so a caller can tell a plain release from
  // one that was also pick- or ship-confirmed, and advance line statuses to match.
  // Without it, a Bulk Initiate run that shipped everything would look identical to a
  // drawer release that stopped at Pick Initiated.
  function outcomeFromBatchResult(r) {
    const status = String((r && r.status) || '').toUpperCase();
    const toNumber = (r && r.toNumber) || '';

    // THREE SUCCESS STAGES, not one. RELEASED / PICK_CONFIRMED / SHIP_CONFIRMED all
    // mean the release worked — they differ only in how far the auto-confirm flags
    // took it. Treating anything but RELEASED as a failure (which the first cut of
    // this function did) would report a fully-shipped bulk run as a total failure.
    const SUCCESS_STAGES = ['RELEASED', 'PICK_CONFIRMED', 'SHIP_CONFIRMED'];
    if (SUCCESS_STAGES.indexOf(status) !== -1) {
      return {
        toNumber:     toNumber,
        outcome:      'released',
        reachedStage: status,
        message:      (r && r.message) || ''
      };
    }

    if (status === 'ALREADY_RELEASED') {
      return {
        toNumber:     toNumber,
        outcome:      'alreadyReleased',
        reachedStage: 'RELEASED',
        message:  (r && r.message) || ('Transfer Order ' + toNumber + ' has already been released.')
      };
    }

    return {
      toNumber: toNumber,
      outcome:  'failed',
      // How far it got BEFORE failing, when OIC says. A TO that released and then
      // failed at ship-confirm has really moved its lines to Pick Initiated, and the
      // caller must be able to reflect that rather than leaving them where they were.
      reachedStage: (r && r.reachedStage) ? String(r.reachedStage).toUpperCase() : null,
      message:  (r && r.message) || 'OIC rejected the release.'
    };
  }

  // POSTs ics/releaseTOBatch for SEVERAL TOs in one call. OIC releases them one
  // at a time and reports a per-TO outcome; one failure does not abort the rest,
  // so a partial release is a normal, reportable result rather than an error.
  //
  // WHY A BATCH ENDPOINT rather than a loop in the browser: releasing a TO is a
  // real inventory movement. A browser-side loop is not recoverable — a closed
  // tab or a dropped connection halfway through leaves some orders released and
  // the rest not, with nothing server-side that knows the set was meant to go
  // together. Handing OIC the whole set makes the sequencing its business.
  //
  // SOURCE ORG IS PER TO, never batch-level: a request has several TOs precisely
  // because Confirm fans out one per source yard, so they routinely differ.
  // Callers must resolve each one before calling (see resolveSourceOrgCode).
  //
  // Never throws. Returns:
  //   { ok: true,  results: [ { toNumber, outcome, message }, ... ] }
  //   { ok: false, message }   — the batch call itself failed; nothing released
  async function releaseTransferOrders(context, Actions, transferOrders, equipmentRequestId) {
    const items = (transferOrders || []).filter(t => t && t.toNumber);
    if (!items.length) {
      return { ok: false, message: 'No transfer orders to release.' };
    }

    const body = {
      transferOrders: items.map(t => ({
        toNumber:  String(t.toNumber),
        sourceOrg: String(t.sourceOrg || ''),
        // SENT EXPLICITLY, never left to a server-side default. These decide how far
        // OIC takes the TO, and "how far did that just go?" must be answerable from
        // the payload alone — a default that changes in OIC would silently change
        // what a click does here.
        //
        // Both default to FALSE, which is the picking drawer's two-step flow:
        // Release stops at Pick Initiated, and Pick and Ship completes it once the
        // equipment has ACTUALLY been picked. Bulk Initiate is the caller that
        // passes true, because "bulk" means the user has already decided not to be
        // asked again per request.
        autoPickConfirm: t.autoPickConfirm === true,
        autoShipConfirm: t.autoShipConfirm === true
      }))
    };
    // Per-TO correlation for a batch that spans SEVERAL requests (Bulk Initiate).
    // Only set when the caller supplied it, so the drawer's single-request payload
    // is unchanged.
    items.forEach((t, i) => {
      if (t.requestId) body.transferOrders[i].requestId = Number(t.requestId);
    });
    // Batch-level correlation: meaningful only when the WHOLE batch is one request,
    // which is the drawer. Bulk Initiate omits it and uses the per-item requestId.
    if (equipmentRequestId) body.equipmentRequestId = Number(equipmentRequestId);

    let oicResp;
    try {
      oicResp = await Actions.callRest(context, { endpoint: 'ics/releaseTOBatch', body: body });
    } catch (e) {
      console.error('[releaseTransferOrders] OIC releaseTOBatch threw:', e);
      return { ok: false, message: 'Network error contacting Integration Cloud.' };
    }

    if (!oicResp || !oicResp.ok) {
      const bodyStr = (oicResp && oicResp.body)
        ? (typeof oicResp.body === 'string' ? oicResp.body : JSON.stringify(oicResp.body))
        : '';
      const serverMsg = (oicResp && oicResp.body && oicResp.body.message) || bodyStr;
      return {
        ok: false,
        message: serverMsg
          ? ('HTTP ' + oicResp.status + ': ' + serverMsg)
          : ('OIC rejected the batch release (HTTP ' + (oicResp && oicResp.status) + ').')
      };
    }

    const results = (oicResp.body && oicResp.body.results) || [];

    // A 200 with no results[] means OIC accepted the call but told us nothing
    // about what it did. Reporting that as success would state, in the banner,
    // that orders were released when we have no evidence of it.
    if (!Array.isArray(results) || !results.length) {
      return {
        ok: false,
        message: 'Integration Cloud returned no release results — check the transfer orders before retrying.'
      };
    }

    return { ok: true, results: results.map(outcomeFromBatchResult) };
  }

  return {
    POST_RELEASE_STATUSES: POST_RELEASE_STATUSES,
    isReleasable:           isReleasable,
    releaseTransferOrder:   releaseTransferOrder,
    releaseTransferOrders:  releaseTransferOrders
  };
});
