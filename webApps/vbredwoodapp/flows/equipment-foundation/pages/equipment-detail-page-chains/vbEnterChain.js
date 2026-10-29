define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class vbEnterChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const equipmentId = $page.variables.equipmentId;

      if (!equipmentId) {
        await Actions.navigateToPage(context, {
          page: 'equipment-master'
        });
        return;
      }

      $page.variables.isLoading = true;

      // ── 1. Master record (always first; other lookups branch off its FKs) ──
      const masterResp = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1EquipmentMasterById',
        uriParams: { id: equipmentId }
      });

      if (!masterResp.ok || !masterResp.body) {
        $page.variables.isLoading = false;
        await Actions.navigateToPage(context, {
          page: 'equipment-master'
        });
        return;
      }

      const apiData = masterResp.body;

      // ── 2. Fan out resolving lookups in parallel ─────────────────────────
      // Class then subclass is sequential (subclass needs classId). Location
      // and serial run in parallel with the class chain.
      const classAndSubclassPromise = (async () => {
        let className = '';
        let subclassName = '';
        if (apiData.equipmentClassId) {
          try {
            const clsResp = await Actions.callRest(context, {
              endpoint: 'eqp-v1/getEquipmentClassById',
              uriParams: { id: Number(apiData.equipmentClassId) }
            });
            if (clsResp.ok && clsResp.body) {
              className = clsResp.body.className || clsResp.body.name || '';
            }
          } catch (e) {
            console.warn('[vbEnterChain] class lookup failed:', e);
          }
          if (apiData.equipmentSubclassId) {
            try {
              const subResp = await Actions.callRest(context, {
                endpoint: 'eqp-v1/getSubclassById',
                uriParams: {
                  classId: Number(apiData.equipmentClassId),
                  id:      Number(apiData.equipmentSubclassId)
                }
              });
              if (subResp.ok && subResp.body) {
                subclassName = subResp.body.subclassName || subResp.body.name || '';
              }
            } catch (e) {
              console.warn('[vbEnterChain] subclass lookup failed:', e);
            }
          }
        }
        return { className: className, subclassName: subclassName };
      })();

      // Pull the first serial-ref. The serial-ref carries the physical
      // unit's currentLocationId — which is what we want for Location /
      // Equipment Yard / GPS. Falls back to master's currentLocationId
      // only when no serial-ref exists.
      const serialRefPromise = (async () => {
        try {
          const serResp = await Actions.callRest(context, {
            endpoint: 'eqp-v1/getSerialRefs',
            uriParams: { equipmentId: Number(equipmentId) }
          });
          if (serResp.ok && serResp.body && Array.isArray(serResp.body.data) && serResp.body.data.length > 0) {
            return serResp.body.data[0];
          }
        } catch (e) {
          console.warn('[vbEnterChain] serial-ref lookup failed:', e);
        }
        return null;
      })();

      // Pull equipmentImage from the catalog view as a fallback when the
      // serial-ref's equipmentImage is null. Bridge by equipmentName
      // (see project memory: equipment_master_views_schema_gap).
      const catalogImagePromise = (async () => {
        try {
          const catResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1ViewsEquipmentCatalog',
            uriParams: { size: 10000 }
          });
          if (catResp.ok && catResp.body && Array.isArray(catResp.body.data)) {
            const match = catResp.body.data.find(c =>
              (c.equipmentName || '') === (apiData.equipmentName || '')
            );
            if (match && match.equipmentImage) return match.equipmentImage;
          }
        } catch (e) {
          console.warn('[vbEnterChain] catalog image lookup failed:', e);
        }
        return '';
      })();

      // The raw equipment-master/{id} endpoint doesn't expose acqCost —
      // it's only available via the views/equipment-master rollup. Pull
      // it from there and bridge by equipmentName (same pattern as the
      // catalog image lookup).
      const viewMasterPromise = (async () => {
        try {
          const vmResp = await Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1ViewsEquipmentMaster',
            uriParams: { size: 10000 }
          });
          if (vmResp.ok && vmResp.body && Array.isArray(vmResp.body.data)) {
            return vmResp.body.data.find(v =>
              (v.equipmentName || '') === (apiData.equipmentName || '')
            ) || null;
          }
        } catch (e) {
          console.warn('[vbEnterChain] view-master lookup failed:', e);
        }
        return null;
      })();

      const [classes, serialRef, catalogImage, viewMaster] = await Promise.all([
        classAndSubclassPromise,
        serialRefPromise,
        catalogImagePromise,
        viewMasterPromise
      ]);

      // ── Resolve location from the most reliable source. Serial-ref's
      // currentLocationId is preferred (where the physical unit actually
      // is); master's currentLocationId is the fallback. The single
      // getLocationById call returns all four fields we need.
      const locationId = (serialRef && serialRef.currentLocationId) || apiData.currentLocationId;
      let locationName = '';
      let locationCode = '';
      let gpsLatitude  = '';
      let gpsLongitude = '';
      if (locationId) {
        try {
          const locResp = await Actions.callRest(context, {
            endpoint: 'eqp-v1/getLocationById',
            uriParams: { id: Number(locationId) }
          });
          if (locResp.ok && locResp.body) {
            locationName = locResp.body.locationName || locResp.body.address || '';
            locationCode = locResp.body.locationCode || '';
            gpsLatitude  = (locResp.body.latitude  != null) ? String(locResp.body.latitude)  : '';
            gpsLongitude = (locResp.body.longitude != null) ? String(locResp.body.longitude) : '';
          }
        } catch (e) {
          console.warn('[vbEnterChain] location lookup failed:', e);
        }
      }

      // ── 3. Build the record. Master is the base; serial-ref + resolved
      // location fields overlay on top. ──────────────────────────────────
      const record = $page.functions.mapEquipmentData(apiData);
      record.equipment_class    = classes.className    || '—';
      record.equipment_subclass = classes.subclassName || '—';
      record.serial_number      = (serialRef && serialRef.serialNumber) || '—';
      record.location           = locationName || '—';
      // Equipment Yard now shows the LOCATION CODE from the resolved
      // location record (preferred), falling back to OAK_PPM if missing.
      record.owning_org         = locationCode || 'OAK_PPM';
      record.gps_latitude       = gpsLatitude  || '—';
      record.gps_longitude      = gpsLongitude || '—';
      record.equipment_image    =
        (serialRef && serialRef.equipmentImage) ||
        catalogImage ||
        'resources/images/equipment-placeholder.png';

      // Overlay descriptive fields from the serial-ref. Master record
      // leaves most of these blank/hardcoded; serial-ref is the source
      // of truth for the physical unit. EQR_SERIAL_REF schema maps:
      //   attribute6           → color
      //   attribute7           → uom
      //   equipmentDescription → description
      // Per-unit values (manufacturer, mfgYear, capacity, fuelType) are
      // dedicated columns and overlay when master is empty.
      if (serialRef) {
        if (!record.manufacturer)   record.manufacturer   = serialRef.manufacturer || '';
        if (!record.model_year)     record.model_year     = serialRef.mfgYear      || '';
        if (!record.fuel_type)      record.fuel_type      = serialRef.fuelType     || '';
        if (!record.capacity)       record.capacity       = serialRef.capacity     || '';
        if (!record.equipment_type) record.equipment_type = serialRef.equipmentType || '';
        record.color       = serialRef.attribute6           || '';
        record.uom         = serialRef.attribute7           || '';
        record.description = serialRef.equipmentDescription || '';
      }

      // acqCost + equipmentNumber only exist on the views/equipment-master
      // rollup, not the raw equipment-master/{id} endpoint. Overlay both.
      if (viewMaster) {
        if (viewMaster.acqCost != null)   record.acquisition_cost = viewMaster.acqCost;
        if (viewMaster.equipmentNumber)   record.equipment_id     = viewMaster.equipmentNumber;
      }

      // ── 4. Page header + badge ───────────────────────────────────────────
      $page.variables.pageTitle = record.equipment_name;
      $page.variables.pageSubtitle =
        (record.equipment_type || '') + ' · ' +
        (record.equipment_class || '') + ' / ' +
        (record.equipment_subclass || '');

      const statusBadgeMap = {
        'AVAILABLE':   { text: 'AVAILABLE',    status: 'success' },
        'DEPLOYED':    { text: 'DEPLOYED',     status: 'info'    },
        'MAINTENANCE': { text: 'MAINTENANCE',  status: 'warning' },
        'RETIRED':     { text: 'RETIRED',      status: 'danger'  }
      };
      $page.variables.badge = statusBadgeMap[record.status] ||
        { text: record.status || '', status: 'neutral' };

      $page.variables.recordData = record;
      $page.variables.isLoading = false;
    }
  }

  return vbEnterChain;
});
