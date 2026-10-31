define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/fetchAllPages',
  'resources/js/shellBus',
], (ActionChain, Actions, paging, bus) => {
  'use strict';

  // Opens an item's tab, and Refresh. New EquipRite's detailInitChain (itself the old equipment-units page's
  // vbEnterChain), call for call:
  //
  //   1. Master record  → getEquipriteV1EquipmentMasterById(equipmentId)
  //   1b. Class / subclass names → getEquipmentClassById, then getSubclassById (subclass needs the class id)
  //   2. Units rows     → serial-refs, lot-refs or inventory-item-refs by control type. NB the filter param
  //                       differs: /serial-refs and /lot-refs take equipmentId, /inventory-item-refs takes
  //                       eqrEquipmentMasterId (a wrong name is silently dropped and returns every item's units)
  //   3. Locations      → getLocationById per distinct currentLocationId, in parallel
  //   3b. Current org   → getInvOrgs (size 500) indexed by invOrgId, only when a unit carries an org
  //   then the expenditure types and documents, and the Fusion work orders when there are 25 maintenance assets or
  //   fewer (two Fusion calls each).
  //
  // In Next the id comes from the tab (a tab opened by number only finds its id in the list, every page), the control
  // type always from the master record (the old RowClickChain's rule), page access is waited for as the list does,
  // and the tab is named after the item once it is read.
  const TRIES = 60;
  const GAP_MS = 50;

  class loadRecordChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const av = $application.variables;
      for (let i = 0; i < TRIES && !av.pageAccessLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      $page.variables.canWrite = $application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded,
        'EQR_EQUIPMENT_MASTER') === 'FULL';
      $page.variables.isLoading = true;
      $page.variables.loadError = '';

      let equipmentId = $page.variables.id ? String($page.variables.id) : '';
      if (!equipmentId && $page.variables.number) {
        equipmentId = await this.idOf(context, $page.variables.number);
      }
      if (!equipmentId) {
        $page.variables.isLoading = false;
        $page.variables.loadError = $page.variables.number
          ? 'Equipment ' + $page.variables.number + ' was not found in the equipment master.'
          : 'No equipment was named. Open one from the Equipment master.';
        return;
      }
      $page.variables.equipmentId = equipmentId;
      $page.variables.controlType = '';

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
          console.warn('[loadRecordChain] class lookup failed:', e);
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
            console.warn('[loadRecordChain] subclass lookup failed:', e);
          }
        }
      }
      $page.variables.masterRecord = master;
      bus.rename('equipment-item:' + ($page.variables.id || $page.variables.number),
        master.equipmentNumber || master.equipmentName || ('Equipment ' + equipmentId));

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
          console.warn('[loadRecordChain] inv-org lookup failed:', e);
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

    /** A tab opened by number only: the item's id from the list (every page), '' when no item has that number. */
    async idOf(context, number) {
      const rows = await paging.fetchAllPages(o => Actions.callRest(context, o), 'eqp-v1/getEquipriteV1EquipmentMaster', {}, 'equipment by number');
      const want = String(number).trim().toUpperCase();
      const hit = rows.filter((r) => r && String(r.equipmentNumber || '').toUpperCase() === want)[0];
      return hit && hit.id != null ? String(hit.id) : '';
    }
  }

  return loadRecordChain;
});
