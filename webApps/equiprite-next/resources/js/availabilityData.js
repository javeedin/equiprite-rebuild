define([], function () {
  'use strict';

  // What Availability reads, all of it read only: New EquipRite's schedule calls (loadScheduleChain, carried over
  // from Old EquipRite's initSchedulerChain), with the same parameters and order.
  //   1. serial-refs (the units), every equipment class, workbench-lines (the bookings), the equipment master
  //      (name and class of each serial's equipment), together;
  //   2. each unit's current location, each location once;
  //   3. per maintenance asset, the Fusion asset and then its planned work orders, eight assets at a time
  //      (fetched after the page has drawn the bookings: maintenance arrives a moment later).
  // Left out: ship-to-sites, which New reads only for its map pins (Next has no map).
  //
  // `call` is (options) => Actions.callRest(context, options), so this is testable without VB.

  var WO_CONCURRENCY = 8;
  var MAX_PAGES = 100;

  function rowsOf(body) {
    if (!body) return [];
    if (Array.isArray(body.data)) return body.data;
    if (Array.isArray(body.items)) return body.items;
    return Array.isArray(body) ? body : [];
  }

  /**
   * Every row of a paged list (New's fetchAllPages rules). The first call is exactly `first` (the call New makes);
   * further pages follow when the answer says there are more (hasMore, or recordCount above what came, or a full page
   * with neither), at the page size the server used, because these endpoints cap the size asked for silently.
   * @returns Promise<{ ok, rows, status, partial }>; ok false only when the first call failed.
   */
  function readAll(call, endpoint, first) {
    var params = Object.assign({}, first || {});
    var rows = [];
    var page = params.page != null ? Number(params.page) : 0;
    var asked = Number(params.size) || 200;
    function step(uriParams, n) {
      return Promise.resolve(call({ endpoint: endpoint, uriParams: uriParams })).then(function (r) {
        if (!r || !r.ok) {
          return n === 0 ? { ok: false, rows: [], status: r && r.status, partial: false } : { ok: true, rows: rows, status: r && r.status, partial: true };
        }
        var body = r.body || {};
        var batch = rowsOf(body);
        rows = rows.concat(batch);
        var total = Number(body.recordCount);
        var askedNow = Number(uriParams.size) || asked;
        // More when the answer says so; with no hasMore and no recordCount, only a full page means there may be more.
        var more = batch.length > 0 && (body.hasMore === true
          || (body.hasMore !== false && !isNaN(total) && total > rows.length)
          || (body.hasMore === undefined && isNaN(total) && batch.length >= askedNow));
        if (!more || n + 1 >= MAX_PAGES) return { ok: true, rows: rows, status: r.status, partial: more };
        var size = Number(body.pageSize) || batch.length || asked;
        page += 1;
        return step(Object.assign({}, params, { page: page, size: size }), n + 1);
      }, function () {
        return n === 0 ? { ok: false, rows: [], status: 'no answer', partial: false } : { ok: true, rows: rows, status: 'no answer', partial: true };
      });
    }
    return step(params, 0);
  }

  function http(r) { return (r && r.status) || 'no answer'; }

  /**
   * The units, classes, bookings, masters and locations.
   * @returns Promise<{ serials, classes, lines, masterById, locationsById, notes: [string], error: string }>
   */
  function loadCore(call) {
    return Promise.all([
      // One row per physical unit: serial-refs holds serials only.
      readAll(call, 'eqp-v1/getSerialRefs', { size: 10000 }),
      // Every class, not the first page.
      readAll(call, 'eqp-v1/getEquipmentClasses', { page: 0, size: 200 }),
      readAll(call, 'eqp-v1/getEquipriteV1ViewsWorkbenchLines', { page: 0, size: 2000 }),
      // Every master page: the endpoint clamps size to 200.
      readAll(call, 'eqp-v1/getEquipriteV1EquipmentMaster', { page: 0, size: 200 })
    ]).then(function (res) {
      var serialR = res[0];
      var linesR = res[2];
      var notes = [];
      var error = '';
      if (!serialR.ok) error = 'The units could not be loaded (HTTP ' + http(serialR) + '), so there is nothing to show.';
      if (serialR.partial) notes.push('Only the first ' + serialR.rows.length + ' units could be loaded.');
      if (!linesR.ok) notes.push('Bookings could not be loaded (HTTP ' + http(linesR) + '): units are shown without them, so do not read them as free.');
      else if (linesR.partial) notes.push('Only the first ' + linesR.rows.length + ' bookings could be loaded: some units may look free when they are not.');
      if (!res[1].ok) notes.push('Equipment classes could not be loaded: units are grouped by the class their bookings name.');
      var masterById = {};
      res[3].rows.forEach(function (m) { if (m && m.id != null) masterById[String(m.id)] = m; });
      var serials = serialR.rows.filter(Boolean);
      // Each unit's current location (the serial's, else its equipment's), each id once, in parallel.
      var ids = [];
      var seen = {};
      serials.forEach(function (s) {
        var m = s.equipmentId != null ? masterById[String(s.equipmentId)] : null;
        var id = s.currentLocationId != null ? s.currentLocationId : (m && m.currentLocationId != null ? m.currentLocationId : null);
        if (id == null || seen[String(id)]) return;
        seen[String(id)] = true;
        ids.push(Number(id));
      });
      return Promise.all(ids.map(function (id) {
        return Promise.resolve(call({ endpoint: 'eqp-v1/getLocationById', uriParams: { id: id } })).catch(function () { return null; });
      })).then(function (locs) {
        var locationsById = {};
        var misses = 0;
        ids.forEach(function (id, i) {
          var r = locs[i];
          if (!r || !r.ok || !r.body) { misses += 1; return; }
          locationsById[String(id)] = { locationName: r.body.locationName || r.body.address || '', locationCode: r.body.locationCode || '' };
        });
        if (misses) notes.push(misses + ' of ' + ids.length + ' unit locations could not be loaded: those units show no yard.');
        return { serials: serials, classes: res[1].rows, lines: linesR.rows, masterById: masterById, locationsById: locationsById, notes: notes, error: error };
      });
    });
  }

  /** A Fusion `q` string literal; an embedded single quote is doubled. */
  function qLit(v) { return "'" + String(v).replace(/'/g, "''") + "'"; }

  function itemsOf(r) {
    var b = r && r.ok ? r.body : null;
    var items = b ? (b.items || b) : null;
    return Array.isArray(items) ? items : [];
  }

  /**
   * Planned work orders by maintenance asset number (New's fetchWorkOrders, unchanged): per asset, the Fusion asset
   * (its id and operating organisation), then the widening ladder asset number, with org, the asset id, with org;
   * the first answer with rows wins. An asset Fusion does not know has no work orders. A failure is per asset.
   * @returns Promise<{ byAsset, assets: n, failed: n }>
   */
  function workOrders(call, serials) {
    var assets = [];
    var seen = {};
    (serials || []).forEach(function (s) {
      var a = s && s.maintenanceAssetNumber;
      if (a && !seen[a]) { seen[a] = true; assets.push(a); }
    });
    var byAsset = {};
    var failed = 0;
    if (!assets.length) return Promise.resolve({ byAsset: byAsset, assets: 0, failed: 0 });

    function one(asset) {
      var id = null;
      var org = '';
      return Promise.resolve(call({ endpoint: 'ProjectLOV/getInstalledBaseAssets', uriParams: { q: 'AssetNumber=' + qLit(asset), limit: 1 } }))
        .then(function (r) {
          var items = r && r.ok && r.body ? (r.body.items || r.body) : null;
          if (!Array.isArray(items) || !items.length) return false;
          if (items[0].AssetId != null) id = String(items[0].AssetId);
          org = items[0].OperatingOrganizationCode || '';
          return true;
        }, function () {
          // A failed lookup is not "asset absent": try the stored key.
          if (/^\d+$/.test(asset)) id = asset;
          return true;
        })
        .then(function (exists) {
          if (!exists) return null;
          var orgQ = org ? ' and OrganizationCode=' + qLit(org) : '';
          var ladder = ['AssetNumber=' + qLit(asset)];
          if (orgQ) ladder.push('AssetNumber=' + qLit(asset) + orgQ);
          if (id) { ladder.push('AssetId=' + id); if (orgQ) ladder.push('AssetId=' + id + orgQ); }
          var i = 0;
          function next() {
            if (i >= ladder.length) return null;
            var q = ladder[i++];
            return Promise.resolve(call({ endpoint: 'ProjectLOV/getMaintenanceWorkOrders', uriParams: { q: q, limit: 100, orderBy: 'PlannedStartDate:desc' } }))
              .then(function (r) {
                var items = itemsOf(r);
                if (!items.length) return next();
                byAsset[asset] = (byAsset[asset] || []).concat(items);
                return null;
              }, function () { failed += 1; return null; });
          }
          return next();
        });
    }

    var at = 0;
    function worker() {
      if (at >= assets.length) return Promise.resolve();
      var a = assets[at++];
      return one(a).then(worker, worker);
    }
    var workers = [];
    for (var k = 0; k < Math.min(WO_CONCURRENCY, assets.length); k++) workers.push(worker());
    return Promise.all(workers).then(function () { return { byAsset: byAsset, assets: assets.length, failed: failed }; });
  }

  return { readAll: readAll, loadCore: loadCore, workOrders: workOrders, qLit: qLit, WO_CONCURRENCY: WO_CONCURRENCY };
});
