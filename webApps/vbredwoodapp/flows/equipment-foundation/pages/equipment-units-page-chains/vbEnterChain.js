define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Builds the units-page data:
  //
  //   1. Master record  → getEquipmentMasterById(equipmentId)
  //   2. Units rows     → serial-refs OR lot-refs (based on controlType param)
  //   3. Locations      → resolve currentLocationId → locationName for each row
  //      (one parallel batch of getLocationById calls)
  //
  // The control branch — one table per control type, and note the filter
  // param differs on the third:
  //   controlType = 'SERIAL'     → /serial-refs?equipmentId=X
  //   controlType = 'LOT'        → /lot-refs?equipmentId=X
  //   controlType = 'INVENTORY'  → /inventory-item-refs?eqrEquipmentMasterId=X
  //
  // Inventory-tracked masters (serial+lot both N) read the inventory-item
  // table, which is their own unit table — not /lot-refs. If empty, the page
  // shows an empty state, which is fine.
  class vbEnterChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const equipmentId = $page.variables.equipmentId;
      const controlType = ($page.variables.controlType || 'SERIAL').toUpperCase();

      if (!equipmentId) {
        await Actions.navigateToPage(context, { page: 'equipment-master' });
        return;
      }

      $page.variables.isLoading = true;

      // ── 1. Master record (header card source of truth) ──────────────────
      const masterResp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1EquipmentMasterById',
        uriParams: { id: equipmentId }
      });

      if (!masterResp.ok || !masterResp.body) {
        $page.variables.isLoading = false;
        await Actions.navigateToPage(context, { page: 'equipment-master' });
        return;
      }
      const master = masterResp.body;

      // ── 1b. Resolve class / subclass names for the definition card.
      // Class then subclass is sequential (subclass needs classId). Same
      // lookup pattern as equipment-detail-page's vbEnterChain.
      if (master.equipmentClassId) {
        try {
          const clsResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipmentClassById',
            uriParams: { id: Number(master.equipmentClassId) }
          });
          if (clsResp.ok && clsResp.body) {
            master.equipmentClassName = clsResp.body.className || clsResp.body.name || '';
          }
        } catch (e) {
          console.warn('[vbEnterChain] class lookup failed:', e);
        }
        if (master.equipmentSubclassId) {
          try {
            const subResp = await Actions.callRest(context, {
              endpoint:  'eqp-v1/getSubclassById',
              uriParams: {
                classId: Number(master.equipmentClassId),
                id:      Number(master.equipmentSubclassId)
              }
            });
            if (subResp.ok && subResp.body) {
              master.equipmentSubclassName = subResp.body.subclassName || subResp.body.name || '';
            }
          } catch (e) {
            console.warn('[vbEnterChain] subclass lookup failed:', e);
          }
        }
      }

      // ── 2. Units rows ───────────────────────────────────────────────────
      // Back to one endpoint per control type. Each table holds a single kind
      // of unit, so the type filter is implicit in the endpoint and no
      // unitType param is needed.
      //
      // The filter param is NOT the same on all three: /serial-refs and
      // /lot-refs take equipmentId, but /inventory-item-refs takes
      // eqrEquipmentMasterId. Passing the wrong name is silently dropped
      // rather than rejected, which would return page 1 of every item in the
      // system and show units belonging to other equipment.
      //
      // The page says INVENTORY where the table is the inventory-item one.
      const unitsEndpoint =
        controlType === 'LOT'       ? 'eqp-v1/getLotRefs'            :
        controlType === 'INVENTORY' ? 'eqp-v1/getInventoryItemRefs'  :
                                      'eqp-v1/getSerialRefs';
      const unitsParams = controlType === 'INVENTORY'
        ? { eqrEquipmentMasterId: Number(equipmentId), size: 10000 }
        : { equipmentId: Number(equipmentId), size: 10000 };
      const unitsResp = await Actions.callRest(context, {
        endpoint:  unitsEndpoint,
        uriParams: unitsParams
      });

      const rawUnits = (unitsResp.ok && unitsResp.body && Array.isArray(unitsResp.body.data))
        ? unitsResp.body.data
        : [];

      // ── 3. Location lookup (resolve currentLocationId → locationName) ───
      const locationIds = Array.from(new Set(
        rawUnits.map(u => u.currentLocationId).filter(id => id != null)
      ));
      const locationsById = {};
      if (locationIds.length > 0) {
        const locResults = await Promise.all(locationIds.map(id =>
          Actions.callRest(context, {
            endpoint:  'eqp-v1/getLocationById',
            uriParams: { id: Number(id) }
          }).catch(() => ({ ok: false }))
        ));
        locResults.forEach((r, i) => {
          if (r && r.ok && r.body) {
            locationsById[locationIds[i]] =
              r.body.locationName || r.body.address || r.body.locationCode || '';
          }
        });
      }

      // ── 3b. CURRENT location (resolve currentInvOrgId → org name) ───────
      // Distinct from the Location column above. currentLocationId is a soft
      // reference to EQR_LOCATION (20 seeded yards); currentInvOrgId is the
      // INVENTORY ORG the unit is presently deployed at, written by
      // resources/js/maintAssetLocation.js when a unit ships to an internal
      // location. Home yard stays on eqpInvOrgName — a deployed unit has not
      // changed which yard owns it.
      //
      // The whole list is fetched once and indexed rather than called per id:
      // /inv-orgs has 345 rows, and its `organizationId` query param is silently
      // ignored, so a per-id call is not available even if it were preferable.
      // Note the index is keyed on invOrgId, the LOCAL surrogate that
      // currentInvOrgId is a foreign key to — NOT the Fusion organizationId.
      const orgsBySurrogate = {};
      // INVENTORY rows carry invOrgId rather than currentInvOrgId, so gate on
      // either — checking only currentInvOrgId skips the lookup entirely for
      // item units and blanks their Current Org column.
      if (rawUnits.some(u => u.currentInvOrgId != null || u.invOrgId != null)) {
        try {
          const orgResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getInvOrgs',
            uriParams: { size: 500 }
          });
          if (orgResp && orgResp.ok && orgResp.body && Array.isArray(orgResp.body.data)) {
            orgResp.body.data.forEach((o) => {
              if (o && o.invOrgId != null) {
                orgsBySurrogate[o.invOrgId] = o.organizationName || o.organizationCode || '';
              }
            });
          }
        } catch (e) {
          // A missing org name costs a blank cell, never the page.
          console.warn('[equipment-units] inv-org lookup failed:', e);
        }
      }

      // Enrich each row with locationName / currentOrgName so column templates
      // don't need any lookup logic — they bind cell.row.<field> directly.
      //
      // Each table carries its own identifier column (serialNumber / lotNumber
      // / itemNumber), so the row already has the right one and the templates
      // in equipment-units-page.html bind it directly. Cross-populate the
      // other two names off whichever is present, so a template that binds the
      // wrong one still renders rather than showing a blank column.
      //
      // EQR_INVENTORY_ITEM_REF has NO currentLocationId / currentInvOrgId —
      // it carries invOrgId instead. Location and Current Org are therefore
      // legitimately blank for INVENTORY rows; fall back to invOrgId for the
      // org so that column still resolves.
      const enriched = rawUnits.map(u => {
        const ident = u.serialNumber || u.lotNumber || u.itemNumber || '';
        const orgId = u.currentInvOrgId != null ? u.currentInvOrgId : u.invOrgId;
        return Object.assign({}, u, {
          serialNumber:   u.serialNumber || ident,
          lotNumber:      u.lotNumber    || ident,
          itemNumber:     u.itemNumber   || ident,
          locationName:   u.currentLocationId ? (locationsById[u.currentLocationId] || '') : '',
          currentOrgName: orgId != null ? (orgsBySurrogate[orgId] || u.invOrgName || '') : ''
        });
      });

      $page.variables.masterRecord = master;
      $page.variables.unitsArray   = enriched;
      $page.variables.pageTitle    = master.equipmentName || 'Equipment Units';
      $page.variables.pageSubtitle = '';

      $page.variables.isLoading = false;
    }
  }

  return vbEnterChain;
});
