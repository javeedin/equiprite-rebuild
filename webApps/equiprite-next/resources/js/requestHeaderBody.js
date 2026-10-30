define(['resources/js/geocoder'], function (geocoder) {
  'use strict';

  // ONE builder for the createEquipmentRequest body, shared by the cart's
  // Submit (SubmitRequestChain) and Save as Draft (SecondaryActionChain), so a
  // draft stores everything a submitted request stores: customer, project
  // contract, delivery mode/ids, default hours, dates, agreement. Before this,
  // Save as Draft had its own hand-written body that dropped 11 of those fields
  // — every draft on paasdev had no customer (2026-10-11).
  //
  // Both buttons create the header as DRAFT. Submit moves it to SUBMITTED /
  // IN_PROCESS only after the lines batch succeeds (DELETE, used to clean up a
  // failed batch, only accepts DRAFT), so the body itself is identical.
  //
  // Also owns the ship-to-site enrichment both buttons run after the header is
  // created (geocode → POST ship-to-site → PATCH header.shipToSiteId).

  function toISODate(val) {
    if (!val) return null;
    return val.includes('T') ? val : val + 'T00:00:00Z';
  }

  // Numeric id through a request.* → detail.* fallback. null for anything that
  // isn't a real number: the columns are NUMBER and '' is a 400, not a no-op.
  function toIdOrNull(primary, fallback) {
    var v = (primary != null && primary !== '') ? primary : fallback;
    if (v == null || v === '') return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  /**
   * Everything the header needs, resolved once from the flow variables. Each
   * form value reads request.* (the live form) first and falls back to
   * detail.* (the ActiveRequestDetail snapshot taken on the way to the
   * catalog), so a refresh between cart-entry and save doesn't lose it.
   *
   * @param {Object} fv - $flow.variables
   */
  function derive(fv) {
    var request   = fv.request || {};
    var detail    = fv.ActiveRequestDetail || {};
    var cartItems = fv.CartItemsArray || [];

    // Request Type PICKER is the source of truth; requestOrigin is the
    // fallback for customer-create-req-page, which has no picker.
    // Same rule as the top of SubmitRequestChain (which the T&C gate needs
    // before this runs) — keep the two identical.
    var chosen = String(request.requestType || fv.requestType || '').toUpperCase();
    var requestType = (chosen === 'EXTERNAL' || chosen === 'INTERNAL')
      ? chosen
      : (fv.requestOrigin === 'customer' ? 'EXTERNAL' : 'INTERNAL');

    var deliveryType = (request.locationType || detail.locationType || null) || null;
    var hoursRaw =
      (request.hours != null && request.hours !== '') ? request.hours :
      (detail.hours  != null && detail.hours  !== '') ? detail.hours  :
      null;

    return {
      request:          request,
      detail:           detail,
      requestType:      requestType,
      isCustomerMode:   requestType === 'EXTERNAL',
      locationText:     (request.location || detail.location || '').trim(),
      deliveryType:     deliveryType,
      isInvOrgDelivery: deliveryType === 'INV_ORG',
      headerHours:      hoursRaw != null ? Number(hoursRaw) : null,
      // Effective request end = the latest line end (a line edited past the
      // header end still has to be covered by the request window).
      maxEffectiveEndDate: cartItems.reduce(function (max, item) {
        var eff = item.endDate || detail.requestedEndDate || '';
        return (!eff || (max && max >= eff)) ? max : eff;
      }, detail.requestedEndDate || ''),
      // EQR_USER id (INTERNAL) or EQR_CUSTOMER_PORTAL_USER id (EXTERNAL) —
      // disjoint id spaces, so only one of the two columns is ever filled.
      pickedUserId:     detail.requestorId != null ? Number(detail.requestorId) : null,
      fromAgreementId:  fv.fromAgreementId || null
    };
  }

  /**
   * The createEquipmentRequest body. Always status DRAFT (see header comment).
   * @param {Object} d      - derive() result
   * @param {string} reqNum - placeholder number; the backend assigns the real one
   */
  function build(d, reqNum) {
    var request = d.request, detail = d.detail, cust = d.isCustomerMode;
    return {
      requestNumber:            reqNum,
      status:                   'DRAFT',
      // CK_EQR_REQ_REQUEST_TYPE: exactly 'INTERNAL' | 'EXTERNAL'.
      requestType:              d.requestType,
      projectRefId:             request.projectId ? Number(request.projectId) : null,
      projectNumber:            detail.projectNumber || request.projectNumber || null,
      projectName:              detail.projectName   || request.projectName   || null,
      // PROJECT_BU_ID / PROJECT_BU_NAME. Null when unknown on purpose: posting
      // rejects a PPM row with no BU rather than book it to the wrong one.
      projectBuId:              detail.projectBuId != null ? Number(detail.projectBuId)
                                : (request.projectBuId != null ? Number(request.projectBuId) : null),
      projectBuName:            detail.projectBuName || request.projectBuName || null,
      taskId:                   request.taskId ? Number(request.taskId) : null,
      taskNumber:               detail.taskNumber || request.taskNumber || null,
      taskName:                 detail.taskName   || request.taskName   || null,
      requestorUserId:          cust ? null : d.pickedUserId,
      eqrCustomerPortalUserId:  cust ? d.pickedUserId : null,
      // INTERNAL requestor = the logged-in user (SeedRequestorChain).
      requestorName:            cust ? null : (request.requestorName     || null),
      requestorUsername:        cust ? null : (request.requestorUsername || null),
      // EXTERNAL customer (EQR_CUSTOMER_REF id) — null on INTERNAL.
      eqrCustomerRefId:         cust && detail.customerRefId != null ? Number(detail.customerRefId) : null,
      customerName:             cust ? (detail.customerName  || null) : null,
      contactName:              cust ? (detail.requestorName || null) : null,
      // INTERNAL customer (a FUSION CustomerId — a different id space from
      // eqrCustomerRefId, so never cross-written). The contract is captured on
      // both types, so it is sent regardless of mode.
      projectInternalCustomerId: (!cust && detail.internalCustomerId != null) ? Number(detail.internalCustomerId) : null,
      projectInternalCustomer:   !cust ? (detail.internalCustomerName || null) : null,
      projectContractId:         detail.contractId != null ? Number(detail.contractId) : null,
      projectContract:           detail.contractNumber || null,
      // Stamped later by whichever path owns the contract / quote.
      contractNumber:           null,
      quoteId:                  null,
      shipToSiteId:             null,
      shipToLocationId:         null,
      // Delivery mode (PROJECT_SITE | DELIVERY_LOCATION | INV_ORG). The two ids
      // only for INV_ORG, and only together, so a stale id from an abandoned
      // INV_ORG pick can't ride out on a map-address request.
      deliveryLocationType:     d.deliveryType,
      deliveryInvOrgId:         d.isInvOrgDelivery ? toIdOrNull(request.deliveryInvOrgId,   detail.deliveryInvOrgId)   : null,
      deliveryLocationId:       d.isInvOrgDelivery ? toIdOrNull(request.deliveryLocationId, detail.deliveryLocationId) : null,
      attribute1:               d.locationText || null,
      requestedStartDate:       toISODate(detail.requestedStartDate),
      requestedEndDate:         toISODate(d.maxEffectiveEndDate),
      defaultHours:             d.headerHours,
      isSoftReservation:        detail.isSoftReservation === true ? 'Y' : 'N',
      eqrAgreementHeaderId:     d.fromAgreementId,
      attribute2:               request.notes || null
    };
  }

  function date10(v) {
    return v ? String(v).substring(0, 10) : null;
  }

  /**
   * The REVERSE of build(): a saved request header (EquipmentRequestDto) back
   * into the two flow objects the create-request form and the cart read —
   * $flow.variables.request (form bindings, requestModel shape) and
   * ActiveRequestDetail (the snapshot NavigateToCatalogChain takes). Kept
   * beside build() on purpose: when a field is added there, add it here.
   *
   * @param {Object} h - the header
   * @returns {{request: Object, detail: Object}}
   */
  function toFlowState(h) {
    h = h || {};
    var external = String(h.requestType || '').toUpperCase() === 'EXTERNAL';
    var requestorId = external
      ? (h.eqrCustomerPortalUserId != null ? Number(h.eqrCustomerPortalUserId) : null)
      : (h.requestorUserId         != null ? Number(h.requestorUserId)         : null);
    var requestorName = external ? (h.contactName || '') : (h.requestorName || '');
    var common = {
      requestorId:        requestorId,
      requestorName:      requestorName,
      location:           h.attribute1 || '',
      locationType:       h.deliveryLocationType || null,
      deliveryInvOrgId:   h.deliveryInvOrgId   != null ? Number(h.deliveryInvOrgId)   : null,
      deliveryLocationId: h.deliveryLocationId != null ? Number(h.deliveryLocationId) : null,
      hours:              h.defaultHours != null ? Number(h.defaultHours) : null,
      projectNumber:      h.projectNumber || '',
      projectName:        h.projectName   || '',
      projectBuId:        h.projectBuId != null ? Number(h.projectBuId) : null,
      projectBuName:      h.projectBuName || '',
      taskNumber:         h.taskNumber || '',
      taskName:           h.taskName   || '',
      contractId:         h.projectContractId != null ? Number(h.projectContractId) : null,
      contractNumber:     h.projectContract || '',
      notes:              h.attribute2 || '',
      isSoftReservation:  h.isSoftReservation === 'Y'
    };
    var request = Object.assign({}, common, {
      requestType:       external ? 'EXTERNAL' : 'INTERNAL',
      requestorUsername: external ? '' : (h.requestorUsername || ''),
      projectId:         h.projectRefId != null ? Number(h.projectRefId) : null,
      taskId:            h.taskId != null ? Number(h.taskId) : null,
      startDate:         date10(h.requestedStartDate),
      endDate:           date10(h.requestedEndDate),
      // Internal customer (Fusion id) on request.customerId/customerName;
      // external customer (EQR_CUSTOMER_REF id) on customerRefId/customerRefName
      // — the same split NavigateToCatalogChain reads.
      customerId:        external ? null : (h.projectInternalCustomerId != null ? Number(h.projectInternalCustomerId) : null),
      customerName:      external ? ''   : (h.projectInternalCustomer || ''),
      customerRefId:     external && h.eqrCustomerRefId != null ? Number(h.eqrCustomerRefId) : null,
      customerRefName:   external ? (h.customerName || '') : ''
    });
    var detail = Object.assign({}, common, {
      projectId:            request.projectId,
      taskId:               request.taskId,
      requestedStartDate:   request.startDate,
      requestedEndDate:     request.endDate,
      customerRefId:        request.customerRefId,
      customerName:         request.customerRefName,
      internalCustomerId:   request.customerId,
      internalCustomerName: request.customerName
    });
    return { request: request, detail: detail };
  }

  /**
   * Create the header, or — when a saved DRAFT is being resumed — update that
   * same request in place so it keeps its number.
   *
   * Update = PATCH of build()'s fields minus the ones that must not move:
   * requestNumber (kept), status (stays DRAFT until Submit moves it), and the
   * ship-to-site / contract / quote links (shipToSiteId is re-linked by
   * attachShipToSite only when the address changed; null here would unlink it).
   *
   * @param {Object} opts { d: derive(), reqNum, resume: {id, requestNumber}|null, headers }
   * @returns {Promise<{ok, status, requestId, requestNumber}>}
   */
  async function saveHeader(context, Actions, opts) {
    var body = build(opts.d, opts.reqNum);
    var res;
    if (opts.resume && opts.resume.id != null) {
      ['requestNumber', 'status', 'shipToSiteId', 'shipToLocationId', 'contractNumber', 'quoteId']
        .forEach(function (k) { delete body[k]; });
      res = await Actions.callRest(context, {
        endpoint:  'eqp-v1/patchEquipmentRequest',
        uriParams: { id: Number(opts.resume.id) },
        headers:   opts.headers || {},
        body:      body
      });
      return {
        ok:            !!(res && res.ok),
        status:        res && res.status,
        requestId:     Number(opts.resume.id),
        requestNumber: opts.resume.requestNumber || (res && res.body && res.body.requestNumber) || opts.reqNum
      };
    }
    res = await Actions.callRest(context, {
      endpoint: 'eqp-v1/createEquipmentRequest',
      headers:  opts.headers || {},
      body:     body
    });
    var ok = !!(res && res.ok && res.body && res.body.id);
    return {
      ok:            ok,
      status:        res && res.status,
      requestId:     ok ? res.body.id : null,
      // The backend assigns the real number from a sequence; the placeholder is
      // only a fallback so a message never renders 'undefined'.
      requestNumber: ok ? (res.body.requestNumber || opts.reqNum) : null
    };
  }

  /**
   * Whether the ship-to-site needs (re)creating: always for a new request; for
   * a resumed draft only when it has none yet or the address text changed.
   */
  function needsShipToSite(d, resume) {
    if (!resume) return true;
    return resume.shipToSiteId == null || (resume.attribute1 || '') !== (d.locationText || '');
  }

  /** Geocode the delivery address; null when there is none or no match. */
  async function geocode(locationText, tag) {
    if (!locationText) return null;
    try {
      var geo = await geocoder.lookup(locationText);
      if (!geo) console.warn(tag, 'geocoder returned no match for address:', locationText);
      return geo || null;
    } catch (e) {
      console.warn(tag, 'geocoder threw, skipping ship-to-site:', e);
      return null;
    }
  }

  /**
   * Ship-to-site, best-effort, after the header exists: EQR_SHIP_TO_SITE needs
   * EQUIPMENT_REQUEST_ID, and the request then needs the site id back.
   *   POST ship-to-site { equipmentRequestId } → siteId
   *   PATCH equipment-request { shipToSiteId }
   * A failure is logged and never fails the save: attribute1 already holds the
   * address text. A deleted DRAFT header takes its ship-to-site with it.
   */
  async function attachShipToSite(context, Actions, opts) {
    if (!opts.geo) return null;
    try {
      var siteResp = await Actions.callRest(context, {
        endpoint: 'eqp-v1/createShipToSite',
        body: {
          siteCode:           'STS-' + opts.reqNum,
          siteName:           opts.geo.formattedAddress || opts.locationText,
          address:            opts.locationText,
          latitude:           opts.geo.latitude,
          longitude:          opts.geo.longitude,
          // projectRefId omitted on purpose: it is an FK to the local
          // EQR_PROJECT_REF, not the Fusion ProjectId (400 if sent).
          equipmentRequestId: Number(opts.requestId)
        }
      });
      if (!(siteResp && siteResp.ok && siteResp.body && siteResp.body.id != null)) {
        console.warn(opts.tag, 'createShipToSite non-OK status:', siteResp && siteResp.status, siteResp && siteResp.body);
        return null;
      }
      var shipToSiteId = Number(siteResp.body.id);
      var patchSiteResp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/patchEquipmentRequest',
        uriParams: { id: opts.requestId },
        body:      { shipToSiteId: shipToSiteId }
      });
      if (!patchSiteResp || !patchSiteResp.ok) {
        console.warn(opts.tag, 'PATCH request.shipToSiteId failed:',
          patchSiteResp && patchSiteResp.status, patchSiteResp && patchSiteResp.body);
      }
      return shipToSiteId;
    } catch (e) {
      console.warn(opts.tag, 'ship-to-site enrichment failed:', e);
      return null;
    }
  }

  /**
   * Labels of the fields a FIRM request needs that this one is missing, read
   * from what the header actually posts. A soft reservation only had to give
   * dates on the create page (NavigateToCatalogChain); Submit uses this to make
   * it complete the rest first. Labels match the create page's.
   *
   * @param {Object}  d - derive() result
   * @param {boolean} projectFieldsShown - false only for an EXTERNAL request
   *        with EXTERNAL_PROJECT_ASSIGN_ENABLED off (no Project/Task on screen)
   */
  function missingForSubmit(d, projectFieldsShown) {
    var request = d.request || {}, detail = d.detail || {}, cust = d.isCustomerMode;
    var missing = [];
    var partyId = cust ? detail.customerRefId : detail.internalCustomerId;
    if (partyId == null || partyId === '') missing.push('Customer');
    if (cust && d.pickedUserId == null) missing.push('Customer Contact');
    if (!d.locationText) missing.push('Delivery Location');
    if (projectFieldsShown) {
      if (!request.projectId) missing.push('Project');
      if (!request.taskId)    missing.push('Task');
    }
    return missing;
  }

  return {
    derive: derive,
    build: build,
    toFlowState: toFlowState,
    saveHeader: saveHeader,
    needsShipToSite: needsShipToSite,
    geocode: geocode,
    attachShipToSite: attachShipToSite,
    toISODate: toISODate,
    missingForSubmit: missingForSubmit
  };
});
