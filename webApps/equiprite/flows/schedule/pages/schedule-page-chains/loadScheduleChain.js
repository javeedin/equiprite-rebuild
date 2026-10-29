define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/fetchAllPages',
], (ActionChain, Actions, paging) => {
  'use strict';

  // Carried over from Old EquipRite flows/main/pages/equipment-schedule-page-chains/initSchedulerChain.js: the same
  // calls, parameters and order. 1) serial-refs, every class (paged), workbench-lines, ship-to-sites and the
  // equipment master, together; 2) each serial's current location; 3) every page of the equipment master; 4) per
  // maintenance asset, the Fusion asset and then its work orders, eight assets at a time. All reads; the old page
  // wrote nothing and neither does this one.
  //
  // What differs is the end: the old chain handed the result straight to Bryntum. This one fills the page's lists,
  // conflicts and filters, says which source failed instead of rendering blanks, and then draws the Gantt and the
  // map (each degrades to the list when its library cannot load).

  // Fusion `q` string literal; an embedded single quote is doubled (old qLit()).
  function qLit(v) {
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  // One asset per call, eight in flight: maintenanceWorkOrders answers a batched OR filter with an empty 200, so the
  // old page queries one asset at a time, as the unit-detail page does.
  const WO_CONCURRENCY = 8;

  // Planned work orders keyed by maintenanceAssetNumber (old fetchWorkOrders, unchanged). An empty object is a
  // valid answer (no maintenance bars); failures are swallowed per asset so Fusion being down never takes out the
  // schedule.
  async function fetchWorkOrders(context, serials) {
    const assetNumbers = [];
    const seen = new Set();
    (serials || []).forEach((s) => {
      const a = s && s.maintenanceAssetNumber;
      if (a && !seen.has(a)) {
        seen.add(a);
        assetNumbers.push(a);
      }
    });
    if (!assetNumbers.length) { return {}; }

    const byAsset = {};
    const fetchOne = async (assetNumber) => {
      // Step 1: resolve the asset in Fusion (its AssetId and OperatingOrganizationCode). A failed lookup is not
      // "asset absent": fall through and try the stored key.
      let resolvedId = null;
      let resolvedOrg = '';
      let assetExists = false;
      try {
        const aResp = await Actions.callRest(context, {
          endpoint: 'ProjectLOV/getInstalledBaseAssets',
          uriParams: { q: 'AssetNumber=' + qLit(assetNumber), limit: 1 },
        });
        const aItems = (aResp && aResp.ok && aResp.body) ? (aResp.body.items || aResp.body) : null;
        if (Array.isArray(aItems) && aItems.length) {
          assetExists = true;
          const fa = aItems[0];
          if (fa.AssetId != null) { resolvedId = String(fa.AssetId); }
          resolvedOrg = fa.OperatingOrganizationCode || '';
        }
      } catch (e) {
        console.warn('[schedule] asset lookup failed for ' + assetNumber + ' - trying the stored key anyway', e);
        assetExists = true;
        if (/^\d+$/.test(assetNumber)) { resolvedId = assetNumber; }
      }
      // Fusion does not know this asset, so it has no work orders to find.
      if (!assetExists) { return; }

      // Step 2: the widening ladder: asset number, with org, the resolved id, with org. First rows win.
      const org = resolvedOrg ? ' and OrganizationCode=' + qLit(resolvedOrg) : '';
      const attempts = ['AssetNumber=' + qLit(assetNumber)];
      if (org) { attempts.push('AssetNumber=' + qLit(assetNumber) + org); }
      if (resolvedId) {
        attempts.push('AssetId=' + resolvedId);
        if (org) { attempts.push('AssetId=' + resolvedId + org); }
      }
      for (let i = 0; i < attempts.length; i++) {
        try {
          const resp = await Actions.callRest(context, {
            endpoint: 'ProjectLOV/getMaintenanceWorkOrders',
            uriParams: { q: attempts[i], limit: 100, orderBy: 'PlannedStartDate:desc' },
          });
          if (!resp || !resp.ok || !resp.body) { continue; }
          const items = resp.body.items || resp.body;
          if (!Array.isArray(items) || !items.length) { continue; }
          // Keyed on the asset number asked for, not the one the row carries.
          (byAsset[assetNumber] = byAsset[assetNumber] || []).push(...items);
          return;
        } catch (e) {
          console.warn('[schedule] work-order lookup failed for ' + assetNumber + ' - it renders without maintenance bars', e);
          return;
        }
      }
    };

    let next = 0;
    const worker = async () => {
      while (next < assetNumbers.length) {
        const idx = next++;
        await fetchOne(assetNumbers[idx]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(WO_CONCURRENCY, assetNumbers.length) }, worker));
    return byAsset;
  }

  const failed = (r) => !r || !r.ok;
  const http = (r) => (r && r.status) || 'no answer';

  class loadScheduleChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      if (!v.viewMonth) {
        v.viewMonth = fns.monthKey(new Date());
      }
      v.isLoading = true;
      v.loadError = '';
      v.notes = [];
      v.ganttState = 'loading';
      v.mapState = 'loading';
      const notes = [];
      let model = null;
      try {
        const [serialResp, classesResp, linesResp, sitesResp, masterResp] = await Promise.all([
          // One scheduler row per physical unit: serial-refs holds serials only.
          Actions.callRest(context, { endpoint: 'eqp-v1/getSerialRefs', uriParams: { size: 10000 } }),
          // Every class, not the first page (it pages at 20 and there are 21).
          paging.fetchAllPages((o) => Actions.callRest(context, o), 'eqp-v1/getEquipmentClasses', {}, 'getEquipmentClasses')
            .then((rows) => ({ ok: true, body: { data: rows } })),
          Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsWorkbenchLines', uriParams: { page: 0, size: 2000 } }),
          // Every ship-to site once: workbench-line -> request -> site -> lat/lon for the booking pins.
          Actions.callRest(context, { endpoint: 'eqp-v1/getShipToSites', uriParams: { size: 10000 } }),
          // Equipment master: name / class / type / manufacturer / year for each serial's equipmentId.
          Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1EquipmentMaster', uriParams: { size: 10000 } }),
        ]);

        if (failed(serialResp)) {
          v.loadError = 'The units could not be loaded (HTTP ' + http(serialResp) + '), so there is nothing to schedule.';
        }
        if (failed(linesResp)) {
          notes.push('Bookings could not be loaded (HTTP ' + http(linesResp) + '): units are shown without them.');
        }
        if (failed(sitesResp)) {
          notes.push('Ship-to sites could not be loaded (HTTP ' + http(sitesResp) + '): bookings have no map pins.');
        }

        const serials = (serialResp && serialResp.ok) ? (serialResp.body.data || []) : [];
        const classes = (classesResp && classesResp.ok) ? (classesResp.body.data || []) : [];
        const allLines = (linesResp && linesResp.ok) ? (linesResp.body.data || []) : [];
        const sites = (sitesResp && sitesResp.ok) ? (sitesResp.body.data || []) : [];
        const masters = (masterResp && masterResp.ok) ? (masterResp.body.data || []) : [];

        // The view returns a line more than once: keep the first per eqrRequestLineId.
        const seenLineIds = new Set();
        const lines = allLines.filter((l) => {
          if (!l) { return false; }
          const k = l.eqrRequestLineId;
          if (k === undefined || k === null) { return true; }
          if (seenLineIds.has(k)) { return false; }
          seenLineIds.add(k);
          return true;
        });

        // Each serial's current location, each id fetched once, in parallel.
        const uniqueLocationIds = Array.from(new Set(
          serials.map((s) => s && s.currentLocationId).filter((id) => id != null).map((id) => Number(id))
        ));
        const locationResults = await Promise.all(uniqueLocationIds.map((id) =>
          Actions.callRest(context, { endpoint: 'eqp-v1/getLocationById', uriParams: { id: Number(id) } })
            .catch((e) => ({ ok: false, _err: e, _id: id }))));
        const locationsById = {};
        let locationMisses = 0;
        uniqueLocationIds.forEach((id, idx) => {
          const r = locationResults[idx];
          if (!r || !r.ok || !r.body) { locationMisses++; return; }
          locationsById[id] = {
            latitude: r.body.latitude != null ? Number(r.body.latitude) : null,
            longitude: r.body.longitude != null ? Number(r.body.longitude) : null,
            locationName: r.body.locationName || r.body.address || '',
            locationCode: r.body.locationCode || '',
          };
        });
        if (locationMisses) {
          notes.push(locationMisses + ' of ' + uniqueLocationIds.length + ' unit locations could not be loaded: those units have no map pin or yard.');
        }

        // requestId -> its (first) ship-to site.
        const siteByRequestId = {};
        sites.forEach((s) => {
          if (!s || s.equipmentRequestId == null) { return; }
          const rid = Number(s.equipmentRequestId);
          if (siteByRequestId[rid] != null) { return; }
          siteByRequestId[rid] = {
            latitude: s.latitude != null ? Number(s.latitude) : null,
            longitude: s.longitude != null ? Number(s.longitude) : null,
            siteName: s.siteName || '',
            address: s.address || '',
          };
        });

        // Every master page: the endpoint clamps size to 200 and says so only in the envelope.
        const masterById = {};
        const allMasters = await paging.fetchAllPages((o) => Actions.callRest(context, o),
          'eqp-v1/getEquipriteV1EquipmentMaster', {}, 'equipment-master');
        (allMasters.length ? allMasters : masters).forEach((m) => {
          if (!m || m.id == null) { return; }
          masterById[Number(m.id)] = m;
        });

        // Planned maintenance from Fusion (the unit-detail page's Maintenance tab's source).
        const workOrdersByAsset = await fetchWorkOrders(context, serials);

        const built = fns.buildResourcesAndEvents(serials, classes, lines, locationsById, siteByRequestId, masterById, workOrdersByAsset);
        model = fns.prepare(built, fns.todayKey());
      } catch (e) {
        console.error('[loadScheduleChain] failed', e);
        v.loadError = 'The schedule could not be loaded.';
      }

      v.notes = notes;
      v.model = model;
      await Actions.callChain(context, { chain: 'applyFilterChain' });
      v.isLoading = false;

      if (!model || !model.resources.length) {
        v.ganttState = 'empty';
        v.mapState = 'empty';
        return;
      }
      const view = { scale: v.scale, month: v.viewMonth, visibleIds: v.visibleIds, projects: (v.filters || {}).projects };
      const [ganttOk, mapOk] = await Promise.all([fns.renderGantt(model, view), fns.renderMap(model, view)]);
      v.ganttState = ganttOk ? 'ready' : 'failed';
      v.mapState = mapOk ? 'ready' : 'failed';
    }
  }

  return loadScheduleChain;
});
