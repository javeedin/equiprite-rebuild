define([
  'resources/js/requestHeaderBody',
  'resources/js/catalogCart',
  'resources/js/draftStorage'
], function (hdr, catalogCart, draftStorage) {
  'use strict';

  // Reopen a saved DRAFT request into the create-request flow (Edit Draft /
  // Submit Draft on the request detail pages), and delete one (Delete Draft).
  //
  // The hand-off reuses the cart's own refresh-resume: InitCartChain already
  // restores request / ActiveRequestDetail / requestOrigin / CartItemsArray from
  // draftStorage, so writing those keys and navigating is all the cart needs.
  // The create-request form picks the same keys up in HydrateDraftChain (case d)
  // / CreateRequestInitChain when the tab-scoped RESUME_FLAG is set.
  //
  // `resumeDraft` ({id, requestNumber, attribute1, shipToSiteId}) tells Submit /
  // Save as Draft to UPDATE that request in place (requestHeaderBody.saveHeader,
  // requestLineBody.saveLines → PUT .../lines/batch) instead of creating a new
  // one, so the draft keeps its number.
  //
  // Prices are NOT taken from the draft: every item is rebuilt from today's
  // catalog for the draft's dates with catalogCart.itemFromRow, exactly as if
  // the user had added it from the catalog, then the saved per-line values
  // (dates, hours, notes) are laid over it.

  var RESUME_FLAG = 'eqr.draft.resume';

  function date10(v) { return v ? String(v).substring(0, 10) : null; }

  /** Header + lines of one request, or { ok:false, message }. */
  async function load(context, Actions, requestId) {
    var hRes = await Actions.callRest(context, {
      endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestById',
      uriParams: { id: Number(requestId) }
    });
    var header = hRes && hRes.ok ? (hRes.body && (hRes.body.data || hRes.body)) : null;
    if (!header || header.id == null) {
      return { ok: false, message: 'The draft could not be loaded (HTTP ' + (hRes && hRes.status) + ').' };
    }
    if (String(header.status || '').toUpperCase() !== 'DRAFT') {
      return { ok: false, message: 'Only a request in Draft status can be reopened; this one is ' + header.status + '.' };
    }
    // size: the endpoint's default page is 20 rows.
    var lRes = await Actions.callRest(context, {
      endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
      uriParams: { requestId: Number(requestId), size: 2000 }
    });
    if (!lRes || !lRes.ok) {
      return { ok: false, message: 'The draft lines could not be loaded (HTTP ' + (lRes && lRes.status) + ').' };
    }
    var lines = (lRes.body && Array.isArray(lRes.body.data)) ? lRes.body.data : [];
    return { ok: true, header: header, lines: lines };
  }

  /**
   * Cart items for the draft's lines, priced from TODAY's catalog.
   * @returns {Promise<{ok, message, items, missing, agreementLineIdByEquipmentId}>}
   */
  async function reprice(context, Actions, header, lines) {
    var start = date10(header.requestedStartDate);
    var end   = date10(header.requestedEndDate);
    var ids = Array.from(new Set(lines
      .map(function (l) { return l.eqrEquipmentMasterId; })
      .filter(function (id) { return id != null; })
      .map(Number)));
    if (!ids.length) {
      return { ok: true, message: '', items: [], missing: lines.slice(), agreementLineIdByEquipmentId: {} };
    }

    // Same rate context the catalog page uses: dates, project, customer,
    // agreement, and the delivery point for nearest-yard rates.
    var external = String(header.requestType || '').toUpperCase() === 'EXTERNAL';
    var params = { size: 2000, requestedQty: 1, equipmentMasterIds: ids.join(',') };
    if (start && end) { params.startDate = start; params.endDate = end; }
    if (header.projectRefId != null) params.projectRefId = Number(header.projectRefId);
    if (external && header.eqrCustomerRefId != null) params.customerRefId = Number(header.eqrCustomerRefId);
    if (header.eqrAgreementHeaderId != null) params.agreementId = Number(header.eqrAgreementHeaderId);
    var geo = await hdr.geocode(header.attribute1 || '', '[draftResume]');
    if (geo) { params.latitude = Number(geo.latitude); params.longitude = Number(geo.longitude); }

    var cRes = await Actions.callRest(context, {
      endpoint:  'eqp-v1/getEquipriteV1ViewsEquipmentCatalog',
      uriParams: params
    });
    if (!cRes || !cRes.ok) {
      return { ok: false, message: 'Current prices could not be loaded (HTTP ' + (cRes && cRes.status) + ').' };
    }
    // Filtered client-side as well: until the backend honours
    // equipmentMasterIds the endpoint returns the whole catalog page.
    var byId = {};
    ((cRes.body && cRes.body.data) || []).forEach(function (r) {
      if (r && r.eqrEquipmentMasterId != null) byId[Number(r.eqrEquipmentMasterId)] = r;
    });
    // Agreement drafts: the catalog reprices billRate/rateUom with the
    // negotiated line rates when agreementId is sent; itemFromRow takes them
    // through its agreementRateMap.
    var agreementRateMap = null;
    if (params.agreementId != null) {
      agreementRateMap = {};
      Object.keys(byId).forEach(function (id) {
        var r = byId[id];
        if (r.billRate != null) agreementRateMap[id] = { billingRate: r.billRate, billingUnit: r.rateUom || 'DAY' };
      });
    }

    var headerHours = header.defaultHours != null ? Number(header.defaultHours) : null;
    var items = [], missing = [], byItemId = {}, agreementLineIdByEquipmentId = {};
    lines.forEach(function (l) {
      var mid = l.eqrEquipmentMasterId != null ? Number(l.eqrEquipmentMasterId) : null;
      var row = mid != null ? byId[mid] : null;
      if (!row) { missing.push(l); return; }
      var qty = Number(l.quantity) || 1;
      // One cart item per equipment (the cart keys on it); a repeat merges.
      if (byItemId[mid]) { byItemId[mid].quantity += qty; return; }
      var it = catalogCart.itemFromRow(row, qty, agreementRateMap);
      // Saved per-line values win where they differ from the header default —
      // the same "line value, else header" rule the cart and builder apply.
      var ls = date10(l.startDate), le = date10(l.endDate);
      if (ls && ls !== start) it.startDate = ls;
      if (le && le !== end)   it.endDate   = le;
      if (l.defaultHours != null && Number(l.defaultHours) !== headerHours) it.hours = Number(l.defaultHours);
      if (l.lineNotes) it.notes = l.lineNotes;
      if (l.eqrAgreementLineId != null) agreementLineIdByEquipmentId[mid] = Number(l.eqrAgreementLineId);
      byItemId[mid] = it;
      items.push(it);
    });
    return { ok: true, message: '', items: items, missing: missing,
             agreementLineIdByEquipmentId: agreementLineIdByEquipmentId };
  }

  /**
   * Load, re-price and stage a draft for the create-request flow. Writes the
   * cart's own draftStorage keys plus `resumeDraft`, and sets the tab-scoped
   * RESUME_FLAG the create-request form looks for.
   *
   * @param {string} requestOrigin - 'project' | 'customer' (which form)
   * @returns {Promise<{ok, message, requestNumber, missing: Array}>}
   */
  async function prepare(context, Actions, requestId, requestOrigin) {
    var loaded = await load(context, Actions, requestId);
    if (!loaded.ok) return { ok: false, message: loaded.message, missing: [] };
    var h = loaded.header;
    var priced = await reprice(context, Actions, h, loaded.lines);
    if (!priced.ok) return { ok: false, message: priced.message, missing: [] };
    if (!priced.items.length) {
      return { ok: false, missing: priced.missing,
               message: 'None of this draft\'s equipment is in the catalog any more, so there is nothing to reopen.' };
    }
    var state = hdr.toFlowState(h);

    draftStorage.clear();
    draftStorage.save('request', state.request);
    draftStorage.save('ActiveRequestDetail', state.detail);
    draftStorage.save('requestOrigin', requestOrigin);
    draftStorage.save('CartItemsArray', priced.items);
    if (h.eqrAgreementHeaderId != null) {
      draftStorage.save('fromAgreementId', Number(h.eqrAgreementHeaderId));
      draftStorage.save('agreementLineIdByEquipmentId', priced.agreementLineIdByEquipmentId);
    }
    draftStorage.save('resumeDraft', {
      id:            Number(h.id),
      requestNumber: h.requestNumber || '',
      attribute1:    h.attribute1 || '',
      shipToSiteId:  h.shipToSiteId != null ? Number(h.shipToSiteId) : null
    });
    try {
      sessionStorage.setItem(RESUME_FLAG, '1');
      // A stale agreement hand-off must not claim this entry instead.
      sessionStorage.removeItem('eqr.agreement.active');
    } catch (e) { /* private mode */ }
    return { ok: true, message: '', requestNumber: h.requestNumber, missing: priced.missing };
  }

  /**
   * True once, right after prepare(): consumes the tab-scoped flag so a later
   * fresh visit to the form is not mistaken for a resume.
   */
  function takeResumeFlag() {
    try {
      var on = sessionStorage.getItem(RESUME_FLAG) === '1';
      sessionStorage.removeItem(RESUME_FLAG);
      return on && draftStorage.hasStoredDraft('resumeDraft');
    } catch (e) {
      return false;
    }
  }

  /** Copy a staged draft from draftStorage into the create-request flow's variables. */
  function hydrateFlow($flow) {
    $flow.variables.request             = draftStorage.load('request') || {};
    $flow.variables.ActiveRequestDetail = draftStorage.load('ActiveRequestDetail') || {};
    $flow.variables.requestOrigin       = draftStorage.load('requestOrigin') || '';
    $flow.variables.CartItemsArray      = draftStorage.load('CartItemsArray') || [];
    $flow.variables.resumeDraft         = draftStorage.load('resumeDraft') || null;
    if (draftStorage.hasStoredDraft('fromAgreementId')) {
      $flow.variables.fromAgreementId = draftStorage.load('fromAgreementId');
      $flow.variables.agreementLineIdByEquipmentId = draftStorage.load('agreementLineIdByEquipmentId') || {};
    }
  }

  /**
   * Delete a DRAFT request — its lines and ship-to-site go with it
   * (DELETE /equipment-requests/{id}, 409 unless DRAFT). isAdmin covers
   * INTERNAL requests, whose requestor carries no user id for the owner check.
   */
  async function deleteDraft(context, Actions, requestId, ownerUserId) {
    var res;
    try {
      res = await Actions.callRest(context, {
        endpoint:  'eqp-v1/deleteEquipmentRequest',
        uriParams: Object.assign({ id: Number(requestId), isAdmin: true },
          ownerUserId != null ? { callerUserId: Number(ownerUserId) } : {})
      });
    } catch (e) {
      res = { ok: false, status: 0 };
    }
    if (res && res.ok) return { ok: true, message: '' };
    return {
      ok: false,
      message: res && res.status === 409
        ? 'Only a request in Draft status can be deleted.'
        : 'The draft could not be deleted (HTTP ' + (res && res.status) + ').'
    };
  }

  return {
    RESUME_FLAG: RESUME_FLAG,
    load: load,
    reprice: reprice,
    prepare: prepare,
    takeResumeFlag: takeResumeFlag,
    hydrateFlow: hydrateFlow,
    deleteDraft: deleteDraft
  };
});
