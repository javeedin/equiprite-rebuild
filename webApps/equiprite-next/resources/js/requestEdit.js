define(['resources/js/catalogCart', 'resources/js/requestLineBody', 'resources/js/currentUser', 'resources/js/fmt'], function (cart, lineBody, cu, fmt) {
  'use strict';

  // Edit request, on a request's record: until anyone has decided it, a project request sent for approval can take more
  // equipment or lose a line. Each change is saved at once and written to the audit trail (entity EQR_EQUIPMENT_REQUEST,
  // ADD_LINE or REMOVE_LINE, who and what), where the request's History reads it (requestHistory.fromEdits).
  //
  //   add     the line New request would have made (catalogCart.itemFromRow, requestLineBody.build) for the request's
  //           dates, posted SUBMITTED (POST .../lines/batch, which takes SUBMITTED lines on a sent request)
  //   remove  the line CANCELLED (PATCH .../lines/batch): there is no line delete, and a cancelled line keeps its place in
  //           the history; it no longer counts (requestList pieces, requestProgress) or holds approval up (approveAllocate)

  var EDITABLE_HEAD = ['SUBMITTED'];
  var UNDECIDED = ['SUBMITTED', 'DRAFT'];
  var REMOVED = 'CANCELLED';

  function up(v) { return String(v == null ? '' : v).trim().toUpperCase(); }

  /** The lines still on the request (not removed). */
  function live(lines) { return (lines || []).filter(function (l) { return up(l.lineStatus) !== REMOVED; }); }

  /**
   * Whether this request can be edited now, and if not, why: { ok, why }. A project request, sent for approval, none of
   * its lines decided yet, and a user who may (may: New request or Approve & allocate with full access).
   */
  function canEdit(head, lines, may) {
    var h = head || {};
    if (!h.id) return { ok: false, why: '' };
    if (h.external) return { ok: false, why: 'A customer request is changed by the customer.' };
    if (EDITABLE_HEAD.indexOf(up(h.status)) === -1) return { ok: false, why: '' };
    if (live(lines).some(function (l) { return UNDECIDED.indexOf(up(l.lineStatus)) === -1; })) {
      return { ok: false, why: 'Part of it has been decided, so it can no longer be changed.' };
    }
    if (!may) return { ok: false, why: '' };
    return { ok: true, why: '' };
  }

  /** The catalog for the request's dates (views/equipment-catalog, as New request reads it). */
  async function loadCatalog(context, Actions, head) {
    var params = { requestedQty: 1 };
    if (head && head.start) params.startDate = String(head.start).slice(0, 10);
    if (head && head.end) params.endDate = String(head.end).slice(0, 10);
    if (head && head.projectRefId != null && head.projectRefId !== '') params.projectRefId = Number(head.projectRefId);
    var res;
    try {
      res = await Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsEquipmentCatalog', uriParams: params });
    } catch (e) {
      res = { ok: false, status: 0 };
    }
    if (!res || !res.ok) return { ok: false, rows: [], message: 'The equipment list could not be loaded (HTTP ' + (res && res.status) + ').' };
    return { ok: true, rows: (res.body && Array.isArray(res.body.data)) ? res.body.data : [], message: '' };
  }

  /** What the add search offers: the catalog rows whose name or class has every typed word, at most `max`. */
  function matches(rows, query, max) {
    var words = String(query || '').toLowerCase().split(/\s+/).filter(function (w) { return !!w; });
    if (!words.length) return [];
    return (rows || []).filter(function (r) {
      var hay = [r.equipmentName, r.name, r.className, r.subclassName, r.category].join(' ').toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) !== -1; });
    }).slice(0, max || 8).map(function (r) {
      var item = cart.itemFromRow(r, 1);
      var free = r.availableQty != null ? Number(r.availableQty) : null;
      return {
        id: String(item.id), name: item.name, cls: item.class,
        price: item.billingRate ? fmt.money(item.billingRate, 'USD') + (item.billingUnit === 'EACH' ? ' each' : ' a day') : 'No list price',
        free: free == null ? '' : (free > 0 ? free + ' free on these dates' : 'None free on these dates')
      };
    });
  }

  function auditBody(head, action, line, actor, summary) {
    return {
      entityName: 'EQR_EQUIPMENT_REQUEST',
      entityId: head.id,
      action: action,
      changedBy: actor || null,
      oldValues: action === 'REMOVE_LINE' ? JSON.stringify({ requestNumber: head.requestNumber, lineId: line.lineId || null, equipment: line.name, quantity: line.qty, lineStatus: 'SUBMITTED' }) : null,
      newValues: action === 'ADD_LINE' ? JSON.stringify({ requestNumber: head.requestNumber, equipment: line.name, quantity: line.qty, lineStatus: 'SUBMITTED' })
        : JSON.stringify({ requestNumber: head.requestNumber, lineId: line.lineId || null, equipment: line.name, quantity: line.qty, lineStatus: REMOVED }),
      changeSummary: summary
    };
  }

  /** Writes the change to the audit trail; a failure is said, the change itself stands. */
  async function audit(context, Actions, body) {
    try {
      var r = await Actions.callRest(context, { endpoint: 'eqp-v1/createAuditTrailEntry', headers: cu.auditHeaders(context), body: body });
      return !!(r && r.ok);
    } catch (e) {
      return false;
    }
  }

  /** Adds `qty` of a catalog row to the request: { ok, message }. */
  async function addLine(context, Actions, o) {
    var head = o.head || {};
    var row = o.row;
    var qty = Math.max(1, Math.floor(Number(o.qty) || 1));
    if (!row) return { ok: false, message: 'Pick the equipment to add first.' };
    var item = cart.itemFromRow(row, qty);
    var body = lineBody.build(item, {
      requestId: head.id, lineStatus: 'SUBMITTED', detail: { requestedStartDate: head.start, requestedEndDate: head.end },
      headerHours: null, agreementLineMap: {}, quotePending: false
    });
    var res;
    try {
      res = await Actions.callRest(context, { endpoint: 'eqp-v1/createRequestLinesBatch', uriParams: { requestId: head.id },
        headers: cu.auditHeaders(context), body: { lines: [body] } });
    } catch (e) {
      res = { ok: false, status: 0, body: { message: String((e && e.message) || e) } };
    }
    if (!res || !res.ok) {
      return { ok: false, message: (lineBody.batchErrorText(res && res.body, [item]) || ('It could not be added (HTTP ' + (res && res.status) + ').')) + ' Nothing was changed.' };
    }
    var actor = cu.auditActor(context);
    var what = item.name + ' × ' + qty;
    var logged = await audit(context, Actions, auditBody(head, 'ADD_LINE', { name: item.name, qty: qty }, actor,
      'Added to ' + head.requestNumber + ' before approval: ' + what + '.'));
    return { ok: true, message: what + ' added to ' + head.requestNumber + '. The Equipment Manager decides it with the rest.'
      + (logged ? '' : ' (The change could not be written to the history.)') };
  }

  /** Removes a line from the request (CANCELLED): { ok, message }. The last line cannot go. */
  async function removeLine(context, Actions, o) {
    var head = o.head || {};
    var line = o.line;
    if (!line) return { ok: false, message: 'That line is not on the request any more.' };
    if (live(o.lines).length <= 1) {
      return { ok: false, message: 'A request needs at least one piece of equipment: add another before removing this one.' };
    }
    var res = await lineBody.updateLines(context, Actions, {
      requestId: head.id, headers: cu.auditHeaders(context),
      updates: [{ id: Number(line.lineId), lineStatus: REMOVED }], labels: [line.name]
    });
    if (!res || !res.ok) return { ok: false, message: ((res && res.message) || 'It could not be removed.') + ' Nothing was changed.' };
    var actor = cu.auditActor(context);
    var what = line.name + ' × ' + (line.qty || 1);
    var logged = await audit(context, Actions, auditBody(head, 'REMOVE_LINE', line, actor,
      'Removed from ' + head.requestNumber + ' before approval: ' + what + '.'));
    return { ok: true, message: what + ' removed from ' + head.requestNumber + '.' + (logged ? '' : ' (The change could not be written to the history.)') };
  }

  return { canEdit: canEdit, live: live, loadCatalog: loadCatalog, matches: matches, addLine: addLine, removeLine: removeLine, auditBody: auditBody,
    REMOVED: REMOVED };
});
