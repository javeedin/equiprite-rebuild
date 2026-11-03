define([
  'resources/js/requestDetailLines',
  'resources/js/requestLineBody',
  'resources/js/currentUser',
], function (rdl, lineBody, cu) {
  'use strict';

  /**
   * CONFIRM FOR PICKING, in Next: Old EquipRite's Confirm Request (request-detail ActionChain, confirmRequest), on the
   * pieces whose unit is assigned. The same calls, bodies and order as Old's server-planned path:
   *
   *   0. the lines   views/request-detail-lines (requestDetailLines.fetchAndBuild: Old's line shape)
   *                  + transfer-orders?equipmentRequestId and transfer-order-lines: a line already on one is left out
   *   1. plan        POST requests/{id}/transfer-orders/plan { lineIds, fallbackYardOrgId }  -> buckets (one per
   *                  source yard), blocks (why a line cannot go), fAndMLineIds (fixed assets: no transfer order)
   *   2. per bucket  POST .../reserve { lineIds, batchNumber, idempotencyKey, leg: 'OUTBOUND' }  (closes the window
   *                  for a second, duplicate transfer order; a replay creates nothing)
   *                  POST OIC createSupplyRequest (OrderType OUTBOUND): Fusion creates the transfer order; 202
   *                  ok   -> POST .../record: the lines SCHEDULED_FOR_PICKING with the yards stamped, one transaction
   *                         (record not answering: Old's fallback, the allocations stamped and the lines batch-patched)
   *                  fail -> POST .../release-reservation: the lines are free again at once
   *   3. fixed assets POST .../record (batch '-FM'): SCHEDULED_FOR_PICKING without a transfer order (not inventory
   *                  tracked: there is no stock to move)
   *
   * Next's differences, both refusals rather than guesses: a block from the plan stops everything (Old's rule too);
   * and when /plan does not answer, nothing is sent (Old then worked the yards out in the browser; the server plan is
   * the rule now). The pieces offered are the ones with their unit assigned (ALLOCATED) and no transfer order yet: an
   * approved piece with no unit is assigned first (Approve & allocate), so its yard is known.
   */

  // OIC supply-request constants: Old's PAYLOAD_DEFAULTS (and returnLeg's), OUTBOUND.
  var PAYLOAD_DEFAULTS = {
    InterfaceSourceCode: 'EXT',
    SupplyOrderSource: 'EXT',
    SupplyRequestStatus: 'NEW',
    ProcessRequestFlag: 'Y',
    DestinationSubinventoryCode: 'Stores',
    UOMCode: 'zzu',
    BackToBackFlag: 'N',
    SupplyType: 'TRANSFER',
    SupplyOperation: 'CREATE',
    DestinationTypeCode: 'INVENTORY',
    PreparerId: 300000047340498,
    DeliverToRequesterId: 300000047340498,
    OrderType: 'OUTBOUND'
  };
  var PROMOTE_FROM = ['IN_PROCESS', 'QUOTE_ACCEPTED', 'ALLOCATED'];

  // Why the plan refused a line, in words; the first kind in ORDER is the one said (Old's REASON_TEXT and order).
  var REASON_TEXT = {
    NEEDS_ALLOCATION: 'must be allocated first: a fixed asset has no transfer order and no picking step, so the allocation is the only record of which asset goes out',
    NEEDS_QUOTE: 'must be quoted and the quote accepted first: confirming now would commit the equipment before a price is agreed',
    NO_YARD: 'has no allocation, so nothing says which yard it ships from: assign its unit in Approve & allocate',
    NO_ITEM_NUMBER: 'has no equipment number on its equipment master, so it cannot be transferred',
    ALREADY_RESERVED: 'is being confirmed by someone else right now',
    NOT_CONFIRMABLE: 'is not in a state that can be confirmed'
  };
  var ORDER = ['NEEDS_ALLOCATION', 'NEEDS_QUOTE', 'NO_YARD', 'NO_ITEM_NUMBER', 'ALREADY_RESERVED', 'NOT_CONFIRMABLE'];

  function up(s) { return String(s == null ? '' : s).toUpperCase(); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  /** The pieces that can be confirmed: unit assigned (a fixed asset: allocated), no transfer order yet. */
  function confirmable(lines) {
    return (Array.isArray(lines) ? lines : []).filter(function (l) {
      if (!l || up(l.line_status) !== 'ALLOCATED') return false;
      if (l.to_number && String(l.to_number).trim() !== '') return false;
      return !rdl.isFAndM(l) || up(l.alloc_status) === 'ALLOCATED';
    });
  }

  /** Old's buildIdempotencyKey: the same intent gives the same key (two FNV-1a hashes of a canonical string). */
  function idempotencyKey(intent) {
    var ids = (intent.lineIds || []).map(Number).filter(function (n) { return isFinite(n); })
      .sort(function (a, b) { return a - b; }).join(',');
    var canonical = ['v1', String(intent.requestId || ''), ids, String(intent.leg || ''), String(intent.sourceCode || '')].join('|')
      + (Number(intent.attempt) > 0 ? '|a' + Number(intent.attempt) : '');
    var fnv = function (str, seed) {
      var h = seed >>> 0;
      for (var i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return ('00000000' + h.toString(16)).slice(-8);
    };
    return fnv(canonical, 0x811c9dc5) + fnv(canonical, 0x9dc5811c);
  }

  /** A retry after a failed transfer order gets a fresh key (Old's attemptFor). */
  function attemptFor(lines) { return (lines || []).some(function (l) { return l && l.to_retryable === true; }) ? 1 : 0; }

  /** The plan's blocks in words: { title, text }, naming up to four lines of the first kind (Old's message). */
  function blockText(blocks) {
    var list = Array.isArray(blocks) ? blocks : [];
    var picked = null;
    ORDER.forEach(function (code) {
      if (picked) return;
      var g = list.filter(function (b) { return b && b.reasonCode === code; });
      if (g.length) picked = { code: code, rows: g };
    });
    if (!picked) picked = { code: 'NOT_CONFIRMABLE', rows: list };
    var names = picked.rows.slice(0, 4).map(function (b) {
      return 'line ' + (b.lineNumber != null ? b.lineNumber : '?') + ' (' + (b.equipmentName || '?') + ')';
    }).join('; ');
    var title = { NO_YARD: 'No yard to ship from', NEEDS_QUOTE: 'A quote is needed first', ALREADY_RESERVED: 'Being confirmed by someone else' }[picked.code]
      || 'Cannot confirm';
    return {
      title: title,
      text: (picked.rows.length === 1 ? 'This piece ' : 'These pieces ') + (REASON_TEXT[picked.code] || REASON_TEXT.NOT_CONFIRMABLE) + ': ' + names
        + (picked.rows.length > 4 ? ' …' : '') + '. Nothing was sent to Fusion.'
    };
  }

  /** The organisation's subinventory for the destination (bu-org-mappings), else Old's default. */
  function destSubinventory(byCode, destCode) {
    var sub = destCode != null ? byCode[String(destCode)] : null;
    return sub || PAYLOAD_DEFAULTS.DestinationSubinventoryCode;
  }

  /** The OIC createSupplyRequest body for one bucket (one source yard): Old's body, field for field. */
  function payload(o) {
    var ref = 0;
    return {
      InterfaceSourceCode: PAYLOAD_DEFAULTS.InterfaceSourceCode,
      InterfaceBatchNumber: o.batchNumber,
      SupplyRequestStatus: PAYLOAD_DEFAULTS.SupplyRequestStatus,
      SupplyRequestDate: o.nowIso,
      SupplyOrderSource: PAYLOAD_DEFAULTS.SupplyOrderSource,
      SupplyOrderReferenceNumber: o.batchNumber,
      SupplyOrderReferenceId: null,
      ProcessRequestFlag: PAYLOAD_DEFAULTS.ProcessRequestFlag,
      equipmentRequestId: Number(o.requestId),
      OrderType: PAYLOAD_DEFAULTS.OrderType,
      supplyRequestLines: o.items.map(function (item) {
        ref++;
        return {
          InterfaceBatchNumber: o.batchNumber,
          InterfaceSourceCode: PAYLOAD_DEFAULTS.InterfaceSourceCode,
          SupplyOrderSource: PAYLOAD_DEFAULTS.SupplyOrderSource,
          SupplyOrderReferenceLineNumber: String(ref),
          SupplyOrderReferenceLineId: ref,
          SourceOrganizationCode: item.srcCode,
          DestinationOrganizationCode: item.destCode,
          DestinationSubinventoryCode: destSubinventory(o.subinvByCode || {}, item.destCode),
          ItemNumber: item.itemNumber,
          Quantity: item.qty || 1,
          UOMCode: PAYLOAD_DEFAULTS.UOMCode,
          BackToBackFlag: PAYLOAD_DEFAULTS.BackToBackFlag,
          NeedByDate: o.needByIso,
          PreparerId: PAYLOAD_DEFAULTS.PreparerId,
          DeliverToRequesterId: PAYLOAD_DEFAULTS.DeliverToRequesterId,
          SupplyType: PAYLOAD_DEFAULTS.SupplyType,
          SupplyOperation: PAYLOAD_DEFAULTS.SupplyOperation,
          DestinationTypeCode: PAYLOAD_DEFAULTS.DestinationTypeCode,
          requestLineId: Number(item.lineId)
        };
      })
    };
  }

  /** The plan's buckets as Old's items, by source yard: [{ srcCode, items: [{ lineId, itemNumber, qty, … }] }]. */
  function bucketsOf(buckets) {
    return (Array.isArray(buckets) ? buckets : []).map(function (b) {
      return {
        srcCode: b.sourceOrgCode,
        items: (b.lines || []).map(function (pl) {
          return {
            lineId: Number(pl.requestLineId), lineNumber: pl.lineNumber, name: pl.equipmentName || '', itemNumber: pl.itemNumber, qty: pl.qty,
            srcCode: b.sourceOrgCode, destCode: b.destOrgCode,
            srcOrgId: b.sourceOrgId != null ? Number(b.sourceOrgId) : null, srcOrgName: b.sourceOrgName || null,
            destOrgId: b.destOrgId != null ? Number(b.destOrgId) : null, destOrgName: b.destOrgName || null,
            fromFallbackYard: b.fromFallbackYard === true
          };
        })
      };
    }).filter(function (b) { return b.items.length > 0; });
  }

  /** What happened, in words: { ok, tone, title, text } (Old's five outcomes). */
  function outcome(c) {
    var fm = c.fm ? ' ' + plural(c.fm, 'fixed-asset piece') + ' confirmed without a transfer order (not inventory tracked).' : '';
    var conc = (c.replayed ? ' ' + c.replayed + ' already requested (a second click is ignored).' : '')
      + (c.rejected ? ' ' + plural(c.rejected, 'piece') + ' left: someone else is confirming ' + (c.rejected === 1 ? 'it' : 'them') + '.' : '');
    var fails = (c.failures || []).slice(0, 3).join('; ') + ((c.failures || []).length > 3 ? ' …' : '');
    var tos = plural(c.created, 'transfer order');
    if (!c.created && c.replayed && !c.failures.length) {
      return { ok: true, tone: 'warn', title: 'Already requested', text: 'These transfer orders were already requested: nothing more was created.' + fm };
    }
    if (!c.created && c.rejected && !c.failures.length && !c.replayed && !c.fm) {
      return { ok: false, tone: 'warn', title: 'Being confirmed by someone else', text: plural(c.rejected, 'piece') + (c.rejected === 1 ? ' is' : ' are')
        + ' being confirmed by someone else right now, so nothing was created. Refresh in a moment to see their result.' };
    }
    if (c.created && !c.failures.length) {
      return { ok: true, tone: 'ok', title: 'Confirmed for picking', text: tos + ' requested from Fusion' + (c.created > 1 ? ' (one per yard it ships from)' : '')
        + ': ' + plural(c.pieces, 'piece') + ' scheduled for picking. The transfer order number arrives from Fusion in a minute.' + fm + conc };
    }
    if (c.created && c.failures.length) {
      return { ok: true, tone: 'warn', title: 'Partly confirmed', text: tos + ' requested; ' + c.failures.length + ' failed: ' + fails
        + '. The pieces of a failed yard are free again: confirm again to retry them.' + fm + conc };
    }
    if (c.fm && !c.failures.length) {
      return { ok: true, tone: 'ok', title: 'Confirmed for picking', text: plural(c.fm, 'fixed-asset piece') + ' confirmed for picking. A fixed asset has no transfer order: '
        + 'it is not inventory tracked, so there is no stock movement to request.' + conc };
    }
    return { ok: false, tone: 'error', title: 'Not confirmed', text: c.failures.length
      ? 'No transfer order was created: ' + fails + '. Nothing changed; confirm again to retry.'
      : 'No transfer order was created.' + conc };
  }

  function call(context, Actions, opts) {
    return Actions.callRest(context, opts).catch(function (e) { return { ok: false, status: 0, body: { message: String((e && e.message) || e) } }; });
  }

  async function subinventories(context, Actions) {
    var byCode = {};
    var r = await call(context, Actions, { endpoint: 'eqp-v1/getBuOrgMappings' });
    ((r && r.ok && r.body && r.body.data) || []).forEach(function (m) {
      var sub = m && m.subinventoryCode ? String(m.subinventoryCode).trim() : '';
      if (m && m.invOrgCode && sub && m.isActiveFlag !== 'N') byCode[String(m.invOrgCode)] = sub;
    });
    return byCode;
  }

  /** Line ids already on a transfer order of the request (Old's alreadyOnTO). */
  async function onTransferOrders(context, Actions, requestId) {
    var ids = {};
    var tos = await call(context, Actions, { endpoint: 'eqp-v1/getTransferOrders', uriParams: { equipmentRequestId: Number(requestId) } });
    var list = (tos && tos.ok && tos.body && tos.body.data) || [];
    var lines = await Promise.all(list.map(function (t) {
      return call(context, Actions, { endpoint: 'eqp-v1/getTransferOrderLines', uriParams: { transferOrderId: Number(t.id) } });
    }));
    lines.forEach(function (r) {
      ((r && r.ok && r.body && r.body.data) || []).forEach(function (tl) { if (tl.requestLineId != null) ids[String(tl.requestLineId)] = true; });
    });
    return ids;
  }

  /** /record did not answer: Old's fallback. The allocations get the yards, then the lines are stamped and promoted in one batch. */
  async function recordByHand(context, Actions, requestId, items, statusById) {
    var patches = [];
    await Promise.all(items.map(async function (it) {
      var resp = await call(context, Actions, { endpoint: 'eqp-v1/getAllocations', uriParams: { requestLineId: it.lineId } });
      ((resp && resp.ok && resp.body && resp.body.data) || []).forEach(function (a) {
        var active = up(a.allocationStatus) !== 'RELEASED' && !a.releasedDate;
        if (!active) return;
        if (it.srcOrgId != null && a.eqpInvOrgId != null && Number(a.eqpInvOrgId) !== it.srcOrgId) return;
        patches.push({ id: a.id, it: it });
      });
    }));
    await Promise.all(patches.map(function (p) {
      return call(context, Actions, { endpoint: 'eqp-v1/patchAllocation', uriParams: { id: Number(p.id) }, body: {
        sourceInvOrgId: p.it.srcOrgId, sourceInvOrgName: p.it.srcOrgName, sourceOrgCode: p.it.srcCode,
        destInvOrgId: p.it.destOrgId, destInvOrgName: p.it.destOrgName, destinationOrgCode: p.it.destCode } });
    }));
    var seen = {};
    var updates = [];
    items.forEach(function (it) {
      if (seen[it.lineId]) return;
      seen[it.lineId] = true;
      var body = { id: it.lineId, sourceInvOrgId: it.srcOrgId, sourceInvOrgName: it.srcOrgName, sourceOrgCode: it.srcCode,
        destInvOrgId: it.destOrgId, destInvOrgName: it.destOrgName, destinationOrgCode: it.destCode, allocationMethod: it.fromFallbackYard ? 'AUTO' : 'MANUAL' };
      if (PROMOTE_FROM.indexOf(up(statusById[it.lineId])) !== -1) body.lineStatus = 'SCHEDULED_FOR_PICKING';
      updates.push(body);
    });
    var res = await lineBody.updateLines(context, Actions, { requestId: Number(requestId), headers: cu.auditHeaders(context), updates: updates });
    return !!(res && res.ok);
  }

  /**
   * Confirms a request's pieces with their unit assigned. opts: { requestId, requestNumber, endDate (YYYY-MM-DD, the
   * transfer order's need-by date), now (ms, tests) }. Resolves { ok, tone: ok|warn|error, title, text, changed, created }.
   */
  async function confirm(context, Actions, opts) {
    var o = opts || {};
    var requestId = Number(o.requestId);
    if (!requestId) return { ok: false, tone: 'error', title: 'Not confirmed', text: 'This request has no id yet: open it from Requests.', changed: false };
    var read = await rdl.fetchAndBuild(context, Actions, requestId);
    if (!read || !read.ok) return { ok: false, tone: 'error', title: 'Not confirmed', text: 'Its pieces could not be read, so nothing was sent to Fusion. Try again.', changed: false };
    var candidates = confirmable(read.lines);
    if (!candidates.length) {
      return { ok: false, tone: 'warn', title: 'Nothing to confirm', text: 'No piece has its unit assigned without a transfer order: there is nothing to confirm.', changed: false };
    }
    var onTO = await onTransferOrders(context, Actions, requestId);
    var eligible = candidates.filter(function (l) { return !onTO[String(l.line_id)]; });
    if (!eligible.length) {
      return { ok: false, tone: 'warn', title: 'Nothing to confirm', text: 'Every piece with its unit assigned is already on a transfer order.', changed: false };
    }

    var plan = await call(context, Actions, { endpoint: 'eqp-v1/planConfirm', uriParams: { requestId: requestId },
      body: { lineIds: eligible.map(function (l) { return Number(l.line_id); }), fallbackYardOrgId: null } });
    if (!plan || !plan.ok) {
      return { ok: false, tone: 'error', title: 'Not confirmed', text: 'The transfer orders could not be planned (HTTP ' + ((plan && plan.status) || 0) + ')'
        + ((plan && plan.body && plan.body.message) ? ': ' + plan.body.message : '') + '. Nothing was sent to Fusion; try again.', changed: false };
    }
    var pb = plan.body || {};
    if ((pb.blocks || []).length) {
      var bt = blockText(pb.blocks);
      return { ok: false, tone: 'error', title: bt.title, text: bt.text, changed: false };
    }
    var buckets = bucketsOf(pb.buckets);
    var fmIds = (pb.fAndMLineIds || []).map(Number);
    if (!buckets.length && !fmIds.length) {
      return { ok: false, tone: 'warn', title: 'Nothing to confirm', text: 'The plan has nothing to send: the pieces may have been confirmed meanwhile. Refresh to see them.', changed: false };
    }

    var statusById = {};
    var lineById = {};
    eligible.forEach(function (l) { statusById[Number(l.line_id)] = l.line_status; lineById[Number(l.line_id)] = l; });
    var nowIso = new Date(o.now || Date.now()).toISOString();
    var needByIso = o.endDate ? new Date(String(o.endDate).slice(0, 10) + 'T23:59:59.000Z').toISOString() : nowIso;
    var baseBatch = 'EQR-' + (o.requestNumber || requestId) + '-' + (o.now || Date.now());
    var subinvByCode = buckets.length ? await subinventories(context, Actions) : {};
    var c = { created: 0, replayed: 0, rejected: 0, failures: [], fm: 0, pieces: 0 };

    for (var bi = 0; bi < buckets.length; bi++) {
      var b = buckets[bi];
      var batchNumber = baseBatch + '-' + b.srcCode;
      var lineIds = b.items.map(function (it) { return it.lineId; });
      var key = idempotencyKey({ requestId: requestId, lineIds: lineIds, leg: 'OUTBOUND', sourceCode: b.srcCode,
        attempt: attemptFor(lineIds.map(function (id) { return lineById[id]; })) });
      var resv = await call(context, Actions, { endpoint: 'eqp-v1/reserveConfirm', uriParams: { requestId: requestId }, headers: cu.auditHeaders(context),
        body: { lineIds: lineIds, batchNumber: batchNumber, idempotencyKey: key, leg: 'OUTBOUND' } });
      // Old's rule: a reserve that does not answer does not stop the confirm (it goes ahead unreserved).
      if (resv && resv.ok) {
        var rb = resv.body || {};
        if (rb.replayed === true) { c.replayed++; continue; }
        if (!(rb.reservedLineIds || []).length) { c.rejected += (rb.rejectedLineIds || []).length; continue; }
      }
      var oic = await call(context, Actions, { endpoint: 'ics/createSupplyRequest',
        body: payload({ batchNumber: batchNumber, nowIso: nowIso, needByIso: needByIso, requestId: requestId, items: b.items, subinvByCode: subinvByCode }) });
      if (!oic || !oic.ok) {
        var msg = oic && oic.body && (oic.body.message || JSON.stringify(oic.body));
        c.failures.push('yard ' + b.srcCode + ' (HTTP ' + ((oic && oic.status) || 0) + (msg ? ': ' + msg : '') + ')');
        await call(context, Actions, { endpoint: 'eqp-v1/releaseReservation', uriParams: { requestId: requestId }, body: { batchNumber: batchNumber } });
        continue;
      }
      c.created++;
      c.pieces += lineIds.length;
      var first = b.items[0];
      var rec = await call(context, Actions, { endpoint: 'eqp-v1/recordConfirm', uriParams: { requestId: requestId }, headers: cu.auditHeaders(context),
        body: { batchNumber: batchNumber, lineIds: lineIds, sourceOrgId: first.srcOrgId, sourceOrgCode: first.srcCode, sourceOrgName: first.srcOrgName,
          destOrgId: first.destOrgId, destOrgCode: first.destCode, destOrgName: first.destOrgName, allocationMethod: first.fromFallbackYard ? 'AUTO' : 'MANUAL' } });
      if (!rec || !rec.ok) await recordByHand(context, Actions, requestId, b.items, statusById);
    }

    if (fmIds.length) {
      var fmRec = await call(context, Actions, { endpoint: 'eqp-v1/recordConfirm', uriParams: { requestId: requestId }, headers: cu.auditHeaders(context),
        body: { batchNumber: baseBatch + '-FM', lineIds: fmIds } });
      if (fmRec && fmRec.ok) {
        c.fm = fmIds.length;
      } else {
        var promote = fmIds.filter(function (id) { return PROMOTE_FROM.indexOf(up(statusById[id])) !== -1; });
        var fmBatch = await lineBody.updateLines(context, Actions, { requestId: requestId, headers: cu.auditHeaders(context),
          updates: promote.map(function (id) { return { id: id, lineStatus: 'SCHEDULED_FOR_PICKING' }; }) });
        c.fm = fmBatch && fmBatch.ok ? fmIds.length : fmIds.length - promote.length;
      }
    }
    var out = outcome(c);
    out.changed = c.created > 0 || c.fm > 0;
    out.created = c.created;
    return out;
  }

  return {
    confirm: confirm, confirmable: confirmable, idempotencyKey: idempotencyKey, blockText: blockText, payload: payload,
    bucketsOf: bucketsOf, outcome: outcome, PAYLOAD_DEFAULTS: PAYLOAD_DEFAULTS
  };
});
