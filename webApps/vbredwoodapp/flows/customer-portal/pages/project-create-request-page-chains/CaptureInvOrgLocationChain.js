define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/maintAssetLocation',
], (ActionChain, Actions, maintAssetLocation) => {
  'use strict';

  // Owns everything that happens when a row is picked in the Internal Location
  // LOV (Location Type = 'Internal Location', locationType === 'INV_ORG').
  //
  // Two jobs:
  //   1. Write the display address into $flow.variables.request.location, exactly
  //      as the inline handler this chain replaced did — via the same
  //      $page.functions.formatInvOrgAddress, so the value stored and the value
  //      the field renders still cannot drift.
  //   2. Resolve and store the two FUSION IDS behind that row:
  //      deliveryInvOrgId (the org) and deliveryLocationId (its hr_locations
  //      LocationId), which SubmitRequestChain persists onto the request header.
  //
  // WHY THE IDS ARE NEEDED
  // request.location is a formatted address string — readable, but there is no
  // way back from it to anything Fusion understands. When the equipment later
  // ships, resources/js/maintAssetLocation.js PATCHes the maintenance asset's
  // location in Fusion, and that call takes OperatingOrganizationId +
  // CurrentLocationId. Without these two numbers captured here, that relocation
  // is simply not possible.
  //
  // WHY LOCATIONID NEEDS A LOOKUP
  // The picker's rows come from EQR_BU_ORG_MAPPING (bu-org-mappings). That table
  // mirrors the hr_locations ADDRESS columns — invOrgAddress.js copies them in
  // when an admin saves the mapping — but it never took LOCATION_ID. Fusion's own
  // inventoryOrganizations resource exposes LocationId and is already in the
  // service catalog, so one call bridges the gap.
  //
  // WHY NOT REPOINT THE PICKER AT THE OIC getInvLocations INTEGRATION
  // The old EquipRite app drove its internal-location LOV straight off
  // EQUIPMENT_RITE/EQP_INV_ORG_LOCATION, which returns LOCATION_ID inline, and
  // that integration is still deployed and active on this pod. Rejected here
  // because bu-org-mappings is CURATED and the raw OIC list is not:
  //   * it is scoped to orgRole=DESTINATION_YARD, which is what keeps the
  //     Virtual-PROJ / Virtual-CUSTOMER transfer-order orgs out of a list of
  //     real places you can send equipment to;
  //   * it carries invOrgLatitude/invOrgLongitude, which price the catalog from
  //     the yard nearest the delivery address.
  // Swapping the data source would have silently dropped both.
  //
  // THE LOOKUP IS BEST-EFFORT AND NEVER BLOCKS. If it fails, deliveryLocationId
  // stays null: the request still submits and still shows the right address, and
  // maintAssetLocation.js skips any request whose ids are incomplete. Failing a
  // submit because a Fusion lookup was slow would be the worse trade by far.
  class CaptureInvOrgLocationChain extends ActionChain {

    /**
     * @param {Object} context
     * @param {Object} params
     * @param {Object} params.data the picked bu-org-mappings row, or null on clear
     */
    async run(context, { data }) {
      const { $page, $flow } = context;
      const req = $flow.variables.request;
      if (!req) return;

      // Cleared selection: drop the address AND both ids together. Leaving a
      // stale org id under a blank field is how a request ends up relocating an
      // asset to somewhere nobody chose.
      if (!data) {
        req.location           = '';
        req.deliveryInvOrgId   = null;
        req.deliveryLocationId = null;
        return;
      }

      req.location = $page.functions.formatInvOrgAddress(data);

      const invOrgId = data.invOrgId;
      if (invOrgId == null || invOrgId === '') {
        req.deliveryInvOrgId   = null;
        req.deliveryLocationId = null;
        return;
      }

      // Store the org id FIRST. It is known and correct the instant the row is
      // picked, so a slow or failed location lookup must not be able to lose it —
      // it still identifies the destination yard, and the location id can be
      // backfilled later.
      req.deliveryInvOrgId   = Number(invOrgId);
      req.deliveryLocationId = null;

      // Shared with the ship-time path (resources/js/maintAssetLocation.js), which
      // re-runs this same lookup if the stored id is missing. One owner means a
      // request cannot be captured by one rule and shipped by another, and there is
      // one set of log messages to recognise instead of two.
      //
      // It logs its own distinct reason for every failure mode and never throws,
      // so a null here is already explained in the console.
      const org = await maintAssetLocation.resolveInvOrg(context, Actions, invOrgId);
      const locId = org && org.locationId;
      if (locId != null) {
        req.deliveryLocationId = Number(locId);
      }
    }
  }

  return CaptureInvOrgLocationChain;
});
