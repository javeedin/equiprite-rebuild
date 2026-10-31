define([], function() {
  'use strict';

  // Single source of truth for the in-flight `request` object shape used by
  // the create-request flow ($flow.variables.request). Chains that build a
  // fresh request, reset it, or hydrate it from a draft/agreement should call
  // defaultRequest() instead of hand-writing the object literal, so the shape
  // can never drift between call sites (add a field here once, not in 5 files).
  //
  // Consumed by HydrateDraftChain, ClearAgreementContextChain,
  // SecondaryActionChain (post-submit reset) and CreateRequestNextChain.
  function defaultRequest(overrides) {
    return Object.assign({
      projectId:        null,
      projectNumber:    '',
      projectName:      '',
      taskId:           null,
      taskNumber:       '',
      taskName:         '',
      contractId:       null,
      // Contract NUMBER (the LOV's display label, CONTRACT_NUMBER). Carried
      // alongside contractId so both can be submitted to
      // PROJECT_CONTRACT_ID / PROJECT_CONTRACT — and so the value survives a
      // catalog round-trip, since the picked row object lives on a $page
      // variable that resets on page re-entry.
      contractNumber:   '',
      locationType:     null,
      // ── Internal-location delivery (locationType === 'INV_ORG') ───────────
      // The two Fusion ids behind the chosen yard, resolved at SELECTION time by
      // ResolveInvOrgLocationChain and carried to the request header as
      // deliveryInvOrgId / deliveryLocationId (V343).
      //
      // WHY IDS AND NOT JUST THE ADDRESS. request.location holds a formatted
      // address string — fine for a human, useless to Fusion. When the equipment
      // ships, resources/js/maintAssetLocation.js PATCHes the maintenance asset's
      // location in Fusion, and that call needs OperatingOrganizationId +
      // CurrentLocationId. Without these two numbers there is no way back from the
      // address text to the ids, so the whole relocation is impossible.
      //
      // Resolved at selection rather than at ship on purpose: it records what the
      // requester actually picked, instead of whatever the org's location happens
      // to be weeks later when the truck leaves.
      //
      // Both stay null for PROJECT_SITE and DELIVERY_LOCATION, and are cleared
      // whenever the location type changes — see the Location Type on-value-changed
      // handler on project-create-request-page.
      deliveryInvOrgId:   null,
      deliveryLocationId: null,
      requestorId:      null,
      requestorName:    '',
      startDate:        null,
      endDate:          null,
      hours:            null,
      location:         '',
      // Coordinates of `location`, used to price the catalog from the yard
      // NEAREST the delivery address. Resolved at navigate-to-catalog time:
      // taken from the map drawer when the user picked a point there, otherwise
      // geocoded from the address string — so both delivery modes (map-picked
      // and project ship-to site) end up with coordinates. Null when the
      // address can't be resolved; the catalog then omits them and the backend
      // falls back to its default rate resolution.
      locationLatitude:  null,
      locationLongitude: null,
      siteId:           null,
      customerId:       null,
      // Display name of customerId. Persisted alongside the id because the
      // Internal Customer field is an oj-input-search whose text comes from
      // $page.variables.selectedCustomerObj — a PAGE variable that resets to its
      // default on every page re-entry. Without the name on the flow model, a
      // same-trip return from the catalog left the field blank even though
      // customerId was intact. HydrateDraftChain rebuilds selectedCustomerObj
      // from this pair.
      customerName:     '',
      billingContact:   '',
      billingEmail:     '',
      billingPhone:     '',
      budget:           0,
      creditLimit:      '$50,000.00',
      isSoftReservation: false,
      notes:            ''
    }, overrides || {});
  }

  return { defaultRequest: defaultRequest };
});
