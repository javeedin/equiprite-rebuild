define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/fetchAllPages',
], (ActionChain, Actions, paging) => {
  'use strict';

  // Fusion `q` string literal. Single quotes are the delimiter, so an embedded
  // one has to be doubled or the filter is malformed. Mirrors qLit() in
  // equipment-unit-detail-page-chains/vbEnterChain.js.
  function qLit(v) {
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  // ONE ASSET PER CALL, not a batched OR chain.
  //
  // This started at 25-per-q to turn 167 assets into ~7 calls. Every one of
  // those 7 came back HTTP 200 with "count": 0 — including the batch containing
  // AssetNumber='BT-100000', which is the exact predicate the unit-detail page
  // sends on its own and gets work orders back for. Same endpoint, same
  // parameters (limit + onlyData + orderBy + q), same asset, different answer:
  // the only variable left is the OR chain, so maintenanceWorkOrders evidently
  // does not honour `q` the way a batched filter needs.
  //
  // It fails SILENTLY — 200 with an empty items array, not a 4xx — which is why
  // this looked like "these assets have no work orders" rather than a broken
  // query.
  //
  // So: query one asset at a time, exactly as the page that works does.
  // Concurrency below keeps that from being 167 sequential round trips.
  //
  // How many single-asset requests are in flight at once. Enough to keep page
  // load reasonable, low enough not to hammer Fusion with 167 parallel calls.
  const WO_CONCURRENCY = 8;

  // Planned maintenance work orders for every serial that has a maintenance
  // asset, keyed by AssetNumber.
  //
  // Returns a plain object { assetNumber: [workOrder, …] }. An empty object is
  // a valid answer and means "no maintenance bars" — the Gantt renders exactly
  // as it did before. Failures are swallowed per batch for that reason: Fusion
  // being unreachable must not take out the whole schedule, which is primarily
  // a RENTAL view and only secondarily a maintenance one.
  async function fetchWorkOrders(context, serials) {
    const assetNumbers = [];
    const seen = new Set();
    (serials || []).forEach(s => {
      const a = s && s.maintenanceAssetNumber;
      if (a && !seen.has(a)) {
        seen.add(a);
        assetNumbers.push(a);
      }
    });
    if (!assetNumbers.length) return {};

    const byAsset = {};

    // One asset per request. Two attempts per asset, mirroring the ladder in
    // equipment-unit-detail-page-chains/vbEnterChain.js: AssetNumber first,
    // then AssetId for the numeric-surrogate keys (100001728623616), where
    // AssetNumber holds something else entirely. Stops at the first attempt
    // that returns rows.
    //
    // NO `fields` PROJECTION: Fusion rejects the whole request if any name in
    // the list is wrong, and the names are genuinely uncertain here —
    // mapFusionWorkOrder on the unit-detail page reads status as
    // WorkOrderStatus || WorkOrderStatusName || WorkOrderStatusCode ||
    // SystemStatus || SystemStatusCode because nobody knows which this
    // instance returns. The parameters below are exactly what that page sends.
    const fetchOne = async (assetNumber) => {
      // STEP 1 — resolve the asset in Fusion.
      //
      // This is what was missing. The unit-detail page does NOT query
      // maintenanceWorkOrders with the stored key alone: it first calls
      // installedBaseAssets to get the asset's real AssetId and
      // OperatingOrganizationCode, then feeds BOTH into the work-order filter
      // (see fetchFusionWorkOrders' signature — it takes assetNumber, assetId
      // and orgCode as three separate arguments).
      //
      // It matters for the human-code shape. For BT-100000 the AssetId is a
      // DIFFERENT value — a surrogate held on the asset record — so a lookup
      // that only ever knows the stored 'BT-100000' can try AssetNumber and
      // nothing else. That is exactly the asset that was still showing no bars
      // while the surrogate-keyed one (100001728623616, where AssetNumber and
      // AssetId coincide) worked.
      //
      // Best-effort: if the asset does not resolve we still try the stored key
      // on its own, which is what the surrogate-keyed assets match on anyway.
      // It also EARNS ITS COST. 165 of the 167 stored keys are generated
      // placeholders (MNT-1000000-####) that do not exist in Fusion at all. A
      // non-resolving asset cannot have work orders, so this lookup lets those
      // skip the work-order call entirely — the two requests per asset become
      // one for the overwhelming majority, and the ladder below only runs for
      // assets Fusion actually knows.
      let resolvedId  = null;
      let resolvedOrg = '';
      let assetExists = false;
      try {
        const aResp = await Actions.callRest(context, {
          endpoint:  'ProjectLOV/getInstalledBaseAssets',
          uriParams: { q: 'AssetNumber=' + qLit(assetNumber), limit: 1 }
        });
        const aItems = (aResp && aResp.ok && aResp.body)
          ? (aResp.body.items || aResp.body) : null;
        if (Array.isArray(aItems) && aItems.length) {
          assetExists = true;
          const fa = aItems[0];
          if (fa.AssetId != null) resolvedId = String(fa.AssetId);
          resolvedOrg = fa.OperatingOrganizationCode || '';
        }
      } catch (e) {
        // Do NOT treat a failed lookup as "asset absent" — that would silently
        // drop a real asset on a transient error. Fall through and try the
        // work-order call on the stored key, which is the old behaviour.
        console.warn('[equipment-schedule] asset lookup failed for '
          + assetNumber + ' — trying the stored key anyway', e);
        assetExists = true;
        if (/^\d+$/.test(assetNumber)) resolvedId = assetNumber;
      }

      // Fusion does not know this asset, so it has no work orders to find.
      if (!assetExists) return;

      // STEP 2 — the work orders. Same widening ladder as the unit-detail page:
      // asset number, then with org context, then the resolved id, then that
      // with org. Work orders are raised INSIDE an organization, which several
      // Fusion maintenance resources require as query context, so the org
      // variants are not redundant.
      const org = resolvedOrg ? ' and OrganizationCode=' + qLit(resolvedOrg) : '';
      const attempts = ['AssetNumber=' + qLit(assetNumber)];
      if (org) attempts.push('AssetNumber=' + qLit(assetNumber) + org);
      if (resolvedId) {
        attempts.push('AssetId=' + resolvedId);
        if (org) attempts.push('AssetId=' + resolvedId + org);
      }

      for (let i = 0; i < attempts.length; i++) {
        try {
          const resp = await Actions.callRest(context, {
            endpoint:  'ProjectLOV/getMaintenanceWorkOrders',
            uriParams: {
              q:       attempts[i],
              limit:   100,
              orderBy: 'PlannedStartDate:desc'
            }
          });
          if (!resp || !resp.ok || !resp.body) continue;
          const items = resp.body.items || resp.body;
          if (!Array.isArray(items) || !items.length) continue;

          // Key on the asset number WE asked for, not the one the row carries:
          // an AssetId match returns rows whose AssetNumber is the human code,
          // which would not match the serial's stored key and would leave the
          // bars unreachable.
          (byAsset[assetNumber] = byAsset[assetNumber] || []).push(...items);
          return;
        } catch (e) {
          console.warn('[equipment-schedule] work-order lookup failed for '
            + assetNumber + ' — it renders without maintenance bars', e);
          return;
        }
      }
    };

    // Bounded concurrency: WO_CONCURRENCY workers pulling off a shared queue.
    // Promise.all over all 167 at once would open 167 parallel connections.
    let next = 0;
    const worker = async () => {
      while (next < assetNumbers.length) {
        const idx = next++;
        await fetchOne(assetNumbers[idx]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(WO_CONCURRENCY, assetNumbers.length) }, worker)
    );

    return byAsset;
  }

  class initSchedulerChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const [serialResp, classesResp, linesResp, sitesResp, masterResp] = await Promise.all([
        Actions.callRest(context, {
          // A scheduler row is one physical unit, so this page only ever wants
          // SERIAL units - LOT/ITEM are quantities with no location, no
          // maintenance asset and no allocatedSerial to join on. Reverting to
          // /serial-refs makes that implicit in the endpoint: the table holds
          // serials only, so no unitType filter is needed. The post-merge
          // serials were backfilled into EQR_SERIAL_REF, so all 705 are here.
          endpoint:  'eqp-v1/getSerialRefs',
          uriParams: { size: 10000 }
        }),
        // Every class, not the first page: getEquipmentClasses pages at 20 and
        // there are 21, so a single call dropped the 21st (2026-10-06).
        paging.fetchAllPages(o => Actions.callRest(context, o),
          'eqp-v1/getEquipmentClasses', {}, 'getEquipmentClasses')
          .then(rows => ({ ok: true, body: { data: rows } })),
        Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsWorkbenchLines',
          uriParams: { page: 0, size: 2000 },
        }),
        // Pull every ship-to-site once. Each row carries the request id
        // back-pointer (equipmentRequestId column) so we can bridge
        // workbench-line → request → site → lat/lon for the event markers.
        // page+size are declared in openapi3.json for getShipToSites.
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getShipToSites',
          uriParams: { size: 10000 }
        }),
        // Equipment master is the source of truth for name / class / type /
        // manufacturer / mfgYear. Serial-refs only carry the FK (equipmentId);
        // we resolve it once here and pass a lookup map into the builder so
        // every row gets a populated label.
        Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1EquipmentMaster',
          uriParams: { size: 10000 }
        }),
      ]);

      const serials  = (serialResp  && serialResp.ok)  ? (serialResp.body.data  || []) : [];
      const classes  = (classesResp && classesResp.ok) ? (classesResp.body.data || []) : [];
      const allLines = (linesResp   && linesResp.ok)   ? (linesResp.body.data   || []) : [];
      const sites    = (sitesResp   && sitesResp.ok)   ? (sitesResp.body.data   || []) : [];
      const masters  = (masterResp  && masterResp.ok)  ? (masterResp.body.data  || []) : [];

      // Dedupe workbench-lines by eqrRequestLineId — view returns duplicates per line.
      const seenLineIds = new Set();
      const lines = allLines.filter(l => {
        if (!l) return false;
        const k = l.eqrRequestLineId;
        if (k === undefined || k === null) return true;
        if (seenLineIds.has(k)) return false;
        seenLineIds.add(k);
        return true;
      });

      // ── Resolve every unique currentLocationId off the serial-refs in
      // parallel. We only fetch each location once, then pass the resolved
      // map (id → { latitude, longitude, locationName, locationCode }) into
      // the builder so each resource row gets real lat/long for the map.
      const uniqueLocationIds = Array.from(new Set(
        serials
          .map(s => s && s.currentLocationId)
          .filter(id => id != null)
          .map(id => Number(id))
      ));

      const locationResults = await Promise.all(
        uniqueLocationIds.map(id =>
          Actions.callRest(context, {
            endpoint:  'eqp-v1/getLocationById',
            uriParams: { id: Number(id) }
          }).catch(e => ({ ok: false, _err: e, _id: id }))
        )
      );

      const locationsById = {};
      uniqueLocationIds.forEach((id, idx) => {
        const r = locationResults[idx];
        if (!r || !r.ok || !r.body) return;
        locationsById[id] = {
          latitude:     r.body.latitude     != null ? Number(r.body.latitude)  : null,
          longitude:    r.body.longitude    != null ? Number(r.body.longitude) : null,
          locationName: r.body.locationName || r.body.address || '',
          locationCode: r.body.locationCode || ''
        };
      });

      // Bridge: requestId → ship-to-site row (one site per request). If a
      // request has multiple ship-to-sites (shouldn't happen, but defensive)
      // we keep the first one seen.
      const siteByRequestId = {};
      sites.forEach(s => {
        if (!s || s.equipmentRequestId == null) return;
        const rid = Number(s.equipmentRequestId);
        if (siteByRequestId[rid] != null) return;
        siteByRequestId[rid] = {
          latitude:  s.latitude  != null ? Number(s.latitude)  : null,
          longitude: s.longitude != null ? Number(s.longitude) : null,
          siteName:  s.siteName  || '',
          address:   s.address   || ''
        };
      });

      // equipment-master.id → master row. Builder reads this for each serial
      // via s.equipmentId (the FK), falling back when serial-ref already has
      // a value for the field.
      //
      // getEquipriteV1EquipmentMaster CLAMPS size to 200 and says so only in
      // the response envelope: size=10000 came back recordCount=306,
      // pageSize=200, totalPages=2, hasMore=true. Taking page 0 alone drops
      // 106 masters, and 193 of the 705 serials point at one of them - their
      // equipment name, class, type and manufacturer all render blank with no
      // error. fetchAllPages reads every page instead of trusting size.
      const masterById = {};
      const allMasters = await paging.fetchAllPages(
        (o) => Actions.callRest(context, o),
        'eqp-v1/getEquipriteV1EquipmentMaster',
        {},
        'equipment-master'
      );
      (allMasters.length ? allMasters : masters).forEach(m => {
        if (!m || m.id == null) return;
        masterById[Number(m.id)] = m;
      });

      // Smart-search "Class" filter: only show classes that have at least one
      // serial-ref row in the schedule. Mirrors the builder's class-id
      // derivation (serial-ref wins; equipment-master fills the gap when the
      // serial-ref didn't carry equipmentClassId) so the dropdown stays in
      // lockstep with what's actually rendered in the rail.
      const visibleClassIds = new Set();
      serials.forEach(s => {
        if (!s) return;
        let cid = s.equipmentClassId;
        if (cid == null && s.equipmentId != null) {
          const m = masterById[Number(s.equipmentId)];
          if (m && m.equipmentClassId != null) cid = m.equipmentClassId;
        }
        if (cid != null) visibleClassIds.add(Number(cid));
      });
      const seenClassNames = new Set();
      $page.variables.classOptionsArray = classes
        .filter(c => c && c.id != null && c.className && visibleClassIds.has(Number(c.id)))
        .filter(c => !seenClassNames.has(c.className) && seenClassNames.add(c.className))
        .map(c => ({ value: c.className, label: c.className }))
        .sort((a, b) => a.label.localeCompare(b.label));

      // ── Fusion maintenance work orders, for the planned-maintenance bars ──
      // Same source the unit-detail page's Maintenance tab uses
      // (ProjectLOV/getMaintenanceWorkOrders), so a work order shown there and
      // the bar shown here are the same record — no second interpretation of
      // what is planned.
      //
      // BATCHED, NOT PER-SERIAL. That page fetches one asset at a time because
      // it renders one unit; this page renders every serial (167 of the 225 in
      // dev carry a maintenance asset), and 167 sequential round-trips would
      // dominate page load. Fusion's `q` accepts OR, so asset numbers are
      // chunked into a handful of calls instead.
      //
      // Keyed on maintenanceAssetNumber — the same field unit-detail tries
      // first. Serials without one simply have no maintenance bars, which is
      // correct: no maintenance asset means no work orders to plan against.
      const workOrdersByAsset = await fetchWorkOrders(context, serials);

      const { resources, events, startDate, endDate } =
        $page.functions.buildResourcesAndEvents(serials, classes, lines, locationsById, siteByRequestId, masterById, workOrdersByAsset);

      $page.functions.initScheduler(resources, events, startDate, endDate);
    }
  }

  return initSchedulerChain;
});
