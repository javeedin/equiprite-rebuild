define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/invOrgAddress',
], (ActionChain, Actions, invOrgAddress) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/addBuOrgMappingChain.js, unchanged.

  // "Add Mapping" from the drawer: validate BU/Yard/Yard Type, then PERSIST
  // IMMEDIATELY via an inline upsert-by-BU PUT (all rows for that BU), and reload.
  //
  // NOTE: the upsert is inlined here (not delegated to a separate save chain) on
  // purpose — a chain that is only reachable via callChain (never named in an event
  // listener) is not registered by the VBCS Designer, so callChain to it 404s. This
  // chain IS on a listener (onBuOrgMappingAdd), so inlining keeps it resolvable.
  class addBuOrgMappingChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const m = $page.variables.currentMapping || {};

      if (!m.buId) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Business Unit required',
          message: 'Please select a business unit.',
          displayMode: 'transient', type: 'warning'
        });
        return;
      }
      if (m.orgId == null) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Yard required',
          message: 'Please select a yard.',
          displayMode: 'transient', type: 'warning'
        });
        return;
      }
      if (!m.yardType) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Yard type required',
          message: 'Please select a yard type.',
          displayMode: 'transient', type: 'warning'
        });
        return;
      }

      // No duplicate yards in the table (orgId is the table key). BuOrgMappingsArray
      // now includes inactive (deleted) rows too — only an ACTIVE duplicate should
      // block re-adding, so a previously-removed yard can be mapped again.
      const existing = $page.variables.BuOrgMappingsArray || [];
      if (existing.some(function(r) { return r.orgId === m.orgId && r.isActiveFlag !== 'N'; })) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Yard already mapped',
          message: '"' + (m.orgName || m.orgId) + '" is already in the list.',
          displayMode: 'transient', type: 'error'
        });
        return;
      }

      // Resolve the friendly Yard Type label for display in the read-only table.
      const roles = $page.variables.OrgRoleLovArray || [];
      const match = roles.find(function(r) { return r.value === m.yardType; });
      const yardTypeLabel = match ? match.label : m.yardType;

      // ── Address + coordinate enrichment ─────────────────────────────────
      // Pull the inventory org's physical address from Fusion (BIP report over
      // hr_locations, keyed by the org id we're about to map), then geocode it
      // to lat/long — hr_locations carries no coordinates, so they're derived.
      // Both land in the SAME upsert below, so the row is never written with an
      // address but no coordinates.
      //
      // BEST-EFFORT: enrich() swallows its own failures and resolves to {} if
      // the report or the geocoder is unavailable, so the mapping still saves.
      // Creating the mapping is the admin's actual intent; enrichment is
      // enrichment, and re-saving the row backfills it later.
      //
      // The SOAP call is issued HERE (not inside the module) because only an
      // action chain can reach a VB service-catalog endpoint.
      let addressFields = {};
      try {
        addressFields = await invOrgAddress.enrich(
          (soapBody) => Actions.callRest(context, {
            endpoint: 'bipService/runBIPReport',
            body:     soapBody
          }).then(r => (r && r.ok) ? r.body : null),
          m.orgId
        );
      } catch (e) {
        console.warn('addBuOrgMappingChain: address enrichment failed — saving mapping without it', e);
        addressFields = {};
      }

      const row = Object.assign({
        rowKey:        $page.functions.buOrgRowKey(m.buId, m.orgId),
        buId:          m.buId,
        buName:        m.buName || '',
        orgId:         m.orgId,
        orgName:       m.orgName || '',
        orgCode:       m.orgCode || '',
        location:      m.location || '',
        yardType:      m.yardType,
        yardTypeLabel: yardTypeLabel,
        isTransactable: m.isTransactable === 'N' ? 'N' : 'Y',
        // Optional; only kept for yard types that use one (see buOrgNeedsSubinventory).
        subinventoryCode: ($page.functions.buOrgNeedsSubinventory(m.yardType) && m.subinventoryCode) || null
      }, addressFields);

      const updated = existing.concat([row]);
      $page.variables.BuOrgMappingsArray = updated;
      $page.variables.isBuOrgDrawerOpen = false;

      // Persist immediately: upsert-by-BU PUT expects the BU's current ACTIVE
      // set. BuOrgMappingsArray also carries inactive (deleted) history rows now
      // — those must be excluded here, or re-submitting them with isActiveFlag:
      // 'Y' below would silently reactivate old, unrelated deleted mappings.
      const mappings = updated
        .filter(function (r) { return String(r.buId) === String(m.buId) && r.isActiveFlag !== 'N'; })
        .map(function (r) {
          const out = {
            invOrgId:     r.orgId,
            orgRole:      r.yardType,
            invOrgCode:   r.orgCode || '',
            invOrgName:   r.orgName || '',
            // locationCode, NOT location. The column, the response DTO and
            // Fusion all call it locationCode; `location` was a legacy alias in
            // the upsert request DTO only. The backend now binds both, but
            // sending one name keeps the payload honest — the ADDRESS_FIELDS
            // loop below also emits locationCode (LOCATION_CODE is in that
            // list), so sending `location` too would put two spellings of the
            // same column in one payload.
            locationCode: r.location || r.locationCode || '',
            isActiveFlag: 'Y',
            // Every row of the BU is re-sent, so each must carry its own stored
            // flag — sending a blanket value would overwrite the other rows.
            isTransactable: r.isTransactable === 'N' ? 'N' : 'Y',
            // Sent for EVERY row: this PUT re-saves the whole BU, so leaving it
            // out would wipe the subinventory already saved on the other rows.
            subinventoryCode: r.subinventoryCode || null
          };
          // Carry the address/coordinate columns through when the row has them.
          // Copied field-by-field from a known list rather than spreading `r`,
          // which also holds UI-only keys (rowKey, buName, yardTypeLabel) that
          // don't belong in the payload.
          //
          // Every row in the BU's set is re-sent by this upsert-by-BU PUT, so
          // rows enriched on a PREVIOUS save must keep their address here too —
          // omitting them would blank out columns that are already populated.
          invOrgAddress.ADDRESS_FIELDS.forEach(function (f) {
            const key = f.toLowerCase().replace(/_([a-z0-9])/g, function (mm, c) { return c.toUpperCase(); });
            if (r[key] != null && String(r[key]).trim() !== '') out[key] = r[key];
          });
          if (r.invOrgLatitude  != null) out.invOrgLatitude  = Number(r.invOrgLatitude);
          if (r.invOrgLongitude != null) out.invOrgLongitude = Number(r.invOrgLongitude);
          return out;
        });

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/upsertBuOrgMappingsByBU',
        uriParams: { businessUnitId: Number(m.buId) },
        body: { businessUnitId: Number(m.buId), buName: m.buName || '', mappings: mappings }
      });

      if (result.ok) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Mapping added',
          message: '"' + row.orgName + '" tagged as ' + yardTypeLabel + '.',
          displayMode: 'transient', type: 'confirmation'
        });
        // Reload from server (loadBuOrgMappingsChain is registered via vbEnter).
        await Actions.callChain(context, { chain: 'loadBuOrgMappingsChain' });
      } else {
        console.error('addBuOrgMappingChain: upsert failed', result.statusCode, result.body);
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not save mapping',
          message: 'Status ' + result.statusCode + '. See console.',
          displayMode: 'transient', type: 'error'
        });
      }
    }
  }

  return addBuOrgMappingChain;
});
