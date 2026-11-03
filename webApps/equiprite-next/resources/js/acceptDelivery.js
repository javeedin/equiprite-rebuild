define([
  'resources/js/requestLineBody',
  'resources/js/currentUser',
], function (lineBody, cu) {
  'use strict';

  /**
   * ACCEPT DELIVERY, in Next: New EquipRite's request-detail acceptDeliveryChain (Old's, copied), for every piece of the
   * request that is on its way to site. The same calls, bodies and order:
   *
   *   0. the lines     views/request-detail-lines?requestId (what New's request detail reads: status, consumable and
   *                    auto-consume flags, quantities)
   *   1. per piece     SHIP_TO_SITE forks by what the line is: a rental -> DEPLOYED (on site; then the return path);
   *                    a consumable -> DELIVERED with its delivered quantity, or, when its subclass auto-consumes,
   *                    issued from stock at once: views/line-detail-units (its item number), POST inventory-
   *                    consumptions, then CONSUMED with the quantity (a piece that cannot be issued stays DELIVERED,
   *                    for a manual issue)
   *   2. ONE batch     PATCH equipment-requests/{id}/lines/batch, all or nothing
   *   3. the request   every piece finished (CLOSED, REJECTED, CONSUMED) -> PATCH the header CLOSED; else every piece
   *                    on site (DEPLOYED, DELIVERED, CONSUMED) -> DEPLOYED. Worked out from the lines read and this
   *                    call's own results (a re-read right after the PATCH can see the old statuses).
   */
  var SOURCE_STATE = 'SHIP_TO_SITE';
  var CLOSE_TERMINAL_STATES = ['CLOSED', 'REJECTED', 'CONSUMED'];
  var ON_SITE_STATES = ['DEPLOYED', 'DELIVERED', 'CONSUMED'];

  function up(s) { return String(s == null ? '' : s).toUpperCase(); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  /** A raw views/request-detail-lines row in New's shape (initChain). */
  function lineOf(r, i) {
    return {
      lineId: String(r.lineId != null ? r.lineId : i + 1),
      equipmentName: r.equipmentName || '',
      quantity: r.quantity != null ? r.quantity : '',
      lineStatus: up(r.lineStatus),
      consumableFlag: r.consumableFlag || 'N',
      autoConsumeFlag: r.autoConsumeFlag || 'N',
      deliveredQuantity: r.deliveredQuantity != null ? Number(r.deliveredQuantity) : null
    };
  }

  /** Where an accepted piece goes: a rental on site, a consumable delivered (New's targetFor). */
  function targetFor(line) { return line && line.consumableFlag === 'Y' ? 'DELIVERED' : 'DEPLOYED'; }

  /** The pieces on their way to site, of these lines. */
  function onTheWay(lines) { return (Array.isArray(lines) ? lines : []).filter(function (l) { return l && up(l.lineStatus) === SOURCE_STATE; }); }

  /** The request's status once these lines have these statuses: 'CLOSED', 'DEPLOYED' or '' (New's rollup). */
  function rollup(lines, statusById) {
    var all = Array.isArray(lines) ? lines : [];
    var eff = function (l) { return up((statusById || {})[l.lineId] || l.lineStatus); };
    if (!all.length) return '';
    if (all.every(function (l) { return CLOSE_TERMINAL_STATES.indexOf(eff(l)) !== -1; })) return 'CLOSED';
    if (all.every(function (l) { return ON_SITE_STATES.indexOf(eff(l)) !== -1; })) return 'DEPLOYED';
    return '';
  }

  function call(context, Actions, opts) {
    return Actions.callRest(context, opts).catch(function (e) { return { ok: false, status: 0, body: { message: String((e && e.message) || e) } }; });
  }

  /** Issue a consumable from stock as it is accepted; the quantity issued, or null (New's autoConsumeLine). */
  async function autoConsume(context, Actions, requestId, line, txnDate) {
    var delivered = Number(line.deliveredQuantity);
    var requested = Number(line.quantity);
    var qty = isFinite(delivered) && delivered > 0 ? delivered : requested;
    if (!isFinite(qty) || qty <= 0) return null;
    var units = await call(context, Actions, { endpoint: 'eqp-v1/getEquipriteV1ViewsLineDetailUnits', uriParams: { requestId: requestId, lineId: Number(line.lineId) } });
    var unit = ((units && units.ok && units.body && units.body.data) || [])[0] || null;
    if (!unit || !unit.unitNumber) return null;
    var created = await call(context, Actions, { endpoint: 'eqp-v1/createInventoryConsumption', body: {
      equipmentRequestId: Number(requestId), requestLineId: Number(line.lineId), itemNumber: String(unit.unitNumber), quantityConsumed: qty,
      uomCode: unit.uomCode || 'EA', invOrgId: unit.invOrgId != null ? Number(unit.invOrgId) : null, consumptionType: 'USAGE', transactionDate: txnDate,
      notes: 'Auto-issued on delivery acceptance (subclass AUTO_CONSUME_FLAG)' } });
    return created && created.ok ? qty : null;
  }

  /**
   * Accepts the delivery of every piece of the request on its way to site. opts: { requestId, now (ms, tests) }.
   * Resolves { ok, tone: ok|warn|error, title, text, changed, accepted, header }.
   */
  async function accept(context, Actions, opts) {
    var o = opts || {};
    var requestId = Number(o.requestId);
    if (!requestId) return { ok: false, tone: 'error', title: 'Not accepted', text: 'This request has no id yet: open it from Requests.', changed: false };
    var read = await call(context, Actions, { endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines', uriParams: { requestId: requestId, size: 10000 } });
    if (!read || !read.ok || !read.body || !Array.isArray(read.body.data)) {
      return { ok: false, tone: 'error', title: 'Not accepted', text: 'Its pieces could not be read, so nothing was accepted. Try again.', changed: false };
    }
    var lines = read.body.data.map(lineOf);
    var eligible = onTheWay(lines);
    if (!eligible.length) return { ok: false, tone: 'warn', title: 'Nothing to accept', text: 'No piece of this request is on its way to site.', changed: false };

    var txnDate = new Date(o.now || Date.now()).toISOString().slice(0, 10) + 'T00:00:00Z';
    var consumed = 0;
    var notIssued = 0;
    var plans = [];
    for (var i = 0; i < eligible.length; i++) {
      var l = eligible[i];
      var body = { lineStatus: targetFor(l) };
      if (body.lineStatus === 'DELIVERED') {
        var q = Number(l.quantity);
        if (isFinite(q) && q > 0) body.deliveredQuantity = q;
        if (l.autoConsumeFlag === 'Y') {
          var issued = await autoConsume(context, Actions, requestId, l, txnDate);
          if (issued != null) { body.lineStatus = 'CONSUMED'; body.consumedQuantity = issued; consumed++; } else notIssued++;
        }
      }
      plans.push({ line: l, body: body });
    }
    var batch = await lineBody.updateLines(context, Actions, {
      requestId: requestId, headers: cu.auditHeaders(context),
      updates: plans.map(function (p) { return Object.assign({ id: Number(p.line.lineId) }, p.body); }),
      labels: plans.map(function (p) { return p.line.equipmentName; })
    });
    if (!batch || !batch.ok) {
      return { ok: false, tone: 'error', title: 'Not accepted', changed: false, text: 'Nothing was accepted: ' + ((batch && batch.message) || 'the pieces could not be updated') + '. No piece changed.'
        + (consumed ? ' ' + plural(consumed, 'consumption record') + ' were already made for consumables issued from stock: check them before trying again.' : '') };
    }
    var statusById = {};
    plans.forEach(function (p) { statusById[p.line.lineId] = p.body.lineStatus; });
    var target = rollup(lines, statusById);
    var header = '';
    if (target) {
      var hp = await call(context, Actions, { endpoint: 'eqp-v1/patchEquipmentRequest', uriParams: { id: requestId }, body: { status: target } });
      if (hp && hp.ok) header = target;
    }
    var n = eligible.length;
    var onSite = plans.filter(function (p) { return p.body.lineStatus === 'DEPLOYED'; }).length;
    var text = plural(n, 'piece') + ' accepted' + (onSite === n ? ': on site now.' : ' (' + onSite + ' on site, ' + (n - onSite) + ' delivered).');
    if (consumed) text += ' ' + plural(consumed, 'consumable') + ' issued from stock and consumed.';
    if (notIssued) text += ' ' + plural(notIssued, 'consumable') + ' could not be issued from stock (no item number found): record the material issue by hand.';
    if (header === 'CLOSED') text += ' Everything on the request is finished: it is closed.';
    if (header === 'DEPLOYED') text += ' Everything on the request is on site: it is marked Deployed.';
    return { ok: true, tone: notIssued ? 'warn' : 'ok', title: 'Delivery accepted', text: text, changed: true, accepted: n, header: header };
  }

  return { accept: accept, targetFor: targetFor, onTheWay: onTheWay, rollup: rollup, lineOf: lineOf };
});
