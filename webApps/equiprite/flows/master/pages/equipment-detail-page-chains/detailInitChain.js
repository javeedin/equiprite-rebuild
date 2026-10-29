define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens Equipment detail. The old equipment-units-page-chains/vbEnterChain.js, call for call:
  //
  //   1. Master record  → getEquipriteV1EquipmentMasterById(equipmentId)
  //   1b. Class / subclass names → getEquipmentClassById, then getSubclassById (subclass needs the class id)
  //   2. Units rows     → serial-refs, lot-refs or inventory-item-refs by control type. NB the filter param
  //                       differs: /serial-refs and /lot-refs take equipmentId, /inventory-item-refs takes
  //                       eqrEquipmentMasterId (a wrong name is silently dropped and returns every item's units)
  //   3. Locations      → getLocationById per distinct currentLocationId, in parallel
  //   3b. Current org   → getInvOrgs (size 500) indexed by invOrgId, only when a unit carries an org
  //
  // Differences: the control type comes from the master record itself with the old RowClickChain's rule (that
  // chain read the same record only to pass it along); a missing id or failed read shows an error here instead
  // of silently going back to the list. Then the documents, expenditure types and work orders load.
  class detailInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const av = $application.variables;
      const equipmentId = $page.variables.equipmentId;
      $page.variables.canWrite = $application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded,
        'EQR_EQUIPMENT_MASTER') === 'FULL';

      if (!equipmentId) {
        $page.variables.isLoading = false;
        $page.variables.loadError = 'No equipment was named. Open one from the Equipment list.';
        return;
      }

      $page.variables.isLoading = true;
      $page.variables.loadError = '';

      // ── 1. Master record ─────────────────────────────────────────────────
      const masterResp = await Actions.callRest(context, {
        endpoint:  'eqp-v1/getEquipriteV1EquipmentMasterById',
        uriParams: { id: equipmentId }
      });
      if (!masterResp || !masterResp.ok || !masterResp.body) {
        $page.variables.isLoading = false;
        $page.variables.loadError = 'This equipment could not be loaded (HTTP ' + (masterResp && masterResp.status) + ').';
        return;
      }
      const master = masterResp.body;
      const controlType = String($page.variables.controlType || $page.functions.controlTypeOf(master)).toUpperCase();
      $page.variables.controlType = controlType;

      // ── 1b. Class / subclass names ──────────────────────────────────────
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
          console.warn('[detailInitChain] class lookup failed:', e);
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
            console.warn('[detailInitChain] subclass lookup failed:', e);
          }
        }
      }
      $page.variables.masterRecord = master;

      // ── 2. Units rows ───────────────────────────────────────────────────
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
      const rawUnits = (unitsResp && unitsResp.ok && unitsResp.body && Array.isArray(unitsResp.body.data))
        ? unitsResp.body.data
        : [];

      // ── 3. Location lookup (currentLocationId → locationName) ───────────
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

      // ── 3b. Current org (currentInvOrgId / invOrgId → org name) ─────────
      const orgsBySurrogate = {};
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
          console.warn('[detailInitChain] inv-org lookup failed:', e);
        }
      }

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
      $page.variables.unitsArray = enriched;
      $page.variables.isLoading = false;

      await Promise.all([
        Actions.callChain(context, { chain: 'loadEquipExpTypesChain' }).catch(() => null),
        Actions.callChain(context, { chain: 'loadAttachmentsChain' }).catch(() => null),
      ]);
      const assets = $page.functions.assetNumbers(master, enriched);
      if (assets.length && assets.length <= $page.functions.autoWorkOrderAssets()) {
        await Actions.callChain(context, { chain: 'loadWorkOrdersChain' }).catch(() => null);
      }
    }
  }

  return detailInitChain;
});
