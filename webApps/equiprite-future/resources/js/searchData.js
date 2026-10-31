define(['resources/js/availability', 'resources/js/availabilityData', 'resources/js/requestData'], function (av, avData, requestData) {
  'use strict';

  // What the toolbar's global search and Check availability read: read once, kept a few minutes (MAX_AGE) and shared
  // by both, so the fleet is loaded once, not twice. Read only, and only the parts the caller asks for (the parts this
  // role may see: globalSearch.wants). Nothing is read until first use (the search box focused, the panel opened), so
  // the shell opens as fast as before.
  //
  //   requests     requestData.load (views/my-requests and my-request-lines, shared with every screen)
  //   fleet        the Availability screen's reads (availabilityData.loadCore: serial-refs, equipment classes,
  //                workbench-lines, the equipment master, each unit's location) built into its model (availability.build)
  //                with the requests, as Availability builds it: a booking back at the yard holds nothing
  //   maintenance  planned work orders from Fusion per maintenance asset (availabilityData.workOrders), read only for
  //                Check availability (startMaintenance); the model is then built again with them
  //   transfers    transfer-orders, transfer-history (inter-project transfers without an order) and inv-orgs (the
  //                names of yards and sites), as the Transfers screen reads them
  //
  // A part that fails is left out (snapshot().errors says so) and asked again after RETRY_MS. A change to a request
  // (requestData.onChange) makes the requests stale, and the fleet is built again with the new ones.
  //
  // `call` is (options) => Actions.callRest(context, options).

  var MAX_AGE = 5 * 60 * 1000;
  var RETRY_MS = 30 * 1000;
  var parts = {};
  var pending = {};
  var stale = {};
  var version = 0;

  requestData.onChange(function () { stale.requests = true; });

  function now() { return Date.now(); }

  function fresh(name) {
    var p = parts[name];
    if (!p || stale[name]) return false;
    return now() - p.at < (p.error ? RETRY_MS : MAX_AGE);
  }

  function rowsOf(body) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.data)) return body.data;
    return body && Array.isArray(body.items) ? body.items : [];
  }

  function get(call, endpoint, uriParams) {
    return Promise.resolve().then(function () { return call({ endpoint: endpoint, uriParams: uriParams || {} }); }).then(function (r) {
      if (!r || !r.ok) return { ok: false, status: (r && r.status) || 'no answer', rows: [] };
      return { ok: true, rows: rowsOf(r.body) };
    }, function () { return { ok: false, status: 'no answer', rows: [] }; });
  }

  /** One load of a part at a time; whoever asks meanwhile waits for the same one. Never rejects. */
  function once(name, fn) {
    if (pending[name]) return pending[name];
    var p = Promise.resolve().then(fn).catch(function (e) {
      console.warn('[searchData] ' + name + ' not read', e);
      parts[name] = { data: null, at: now(), error: 'could not be read' };
      version += 1;
    }).then(function () {
      delete pending[name];
      return parts[name];
    });
    pending[name] = p;
    return p;
  }

  /** The fleet's model from what was read and the requests now known. */
  function fleetOf(core, reqs, workOrdersByAsset, maint, today) {
    var t = today || av.todayKey();
    var input = {
      serials: core.serials, classes: core.classes, lines: core.lines, masterById: core.masterById, locationsById: core.locationsById,
      requests: (reqs && reqs.rows) || [], linesByRequest: (reqs && reqs.linesByRequest) || {}, workOrdersByAsset: workOrdersByAsset || {}
    };
    var notes = core.notes.slice();
    if (!reqs || !reqs.linesLoaded) notes.push('Where each booking is on its journey could not be read for every request.');
    return {
      core: core, model: av.build(input, t), today: t, serials: core.serials, masterById: core.masterById, classes: core.classes,
      notes: notes, maint: maint, workOrdersByAsset: workOrdersByAsset || {}, requests: reqs || null
    };
  }

  function loadRequests(context, Actions) {
    return once('requests', function () {
      return requestData.load(context, Actions, {}).then(function (d) {
        var ok = d && !d.error;
        parts.requests = { data: ok ? d : null, at: now(), error: ok ? '' : ((d && d.error) || 'Requests could not be read.') };
        stale.requests = false;
        // The fleet was built with older requests: build it again with these (what is back at the yard holds nothing).
        var f = parts.fleet && parts.fleet.data;
        if (ok && f && f.requests !== d) {
          parts.fleet = Object.assign({}, parts.fleet, { data: fleetOf(f.core, d, f.workOrdersByAsset, f.maint, f.today) });
        }
        version += 1;
      });
    });
  }

  function loadFleet(context, Actions) {
    return once('fleet', function () {
      var call = function (o) { return Actions.callRest(context, o); };
      var reqs = pending.requests || Promise.resolve(parts.requests);
      return Promise.all([avData.loadCore(call), reqs]).then(function (res) {
        var core = res[0];
        var r = res[1] && res[1].data;
        if (core.error) {
          parts.fleet = { data: null, at: now(), error: core.error };
        } else {
          var assets = core.serials.some(function (s) { return s && s.maintenanceAssetNumber; });
          parts.fleet = { data: fleetOf(core, r, {}, assets ? 'later' : 'none'), at: now(), error: '' };
        }
        version += 1;
      });
    });
  }

  function loadTransfers(context, Actions) {
    return once('transfers', function () {
      var call = function (o) { return Actions.callRest(context, o); };
      return Promise.all([
        get(call, 'eqp-v1/getTransferOrders', {}),
        get(call, 'eqp-v1/getTransferHistory', {}),
        get(call, 'eqp-v1/getInvOrgs', { size: 500 })
      ]).then(function (res) {
        parts.transfers = res[0].ok
          ? { data: { orders: res[0].rows, history: res[1].ok ? res[1].rows : [], orgs: res[2].rows }, at: now(), error: '' }
          : { data: null, at: now(), error: 'Transfers could not be read (HTTP ' + res[0].status + ').' };
        version += 1;
      });
    });
  }

  /**
   * Starts reading the parts asked for ({ requests, fleet, transfers }) that are not fresh; the requests first when
   * the fleet needs them. Returns one promise per part started (none when everything is fresh or on its way: those
   * already on their way are returned too, so a caller can wait for them).
   */
  function start(context, Actions, want) {
    var w = want || {};
    var jobs = [];
    if ((w.requests || w.fleet) && (!fresh('requests') || pending.requests)) jobs.push(loadRequests(context, Actions));
    if (w.fleet && (!fresh('fleet') || pending.fleet)) jobs.push(loadFleet(context, Actions));
    if (w.transfers && (!fresh('transfers') || pending.transfers)) jobs.push(loadTransfers(context, Actions));
    return jobs;
  }

  /** Whether start() would read anything (or wait for anything) for these parts. */
  function needs(want) {
    var w = want || {};
    return !!(((w.requests || w.fleet) && (!fresh('requests') || pending.requests)) || (w.fleet && (!fresh('fleet') || pending.fleet))
      || (w.transfers && (!fresh('transfers') || pending.transfers)));
  }

  /** Everything asked for, read: resolves to the snapshot. */
  function ensure(context, Actions, want) {
    return Promise.all(start(context, Actions, want)).then(snapshot);
  }

  /**
   * Planned maintenance for the fleet read (Check availability): a promise that resolves once the model has it, or
   * null when there is nothing to read (no maintenance assets, already read, or no fleet).
   */
  function startMaintenance(context, Actions) {
    var f = parts.fleet && parts.fleet.data;
    if (pending.maintenance) return pending.maintenance;
    if (!f || f.maint !== 'later') return null;
    var call = function (o) { return Actions.callRest(context, o); };
    parts.fleet = Object.assign({}, parts.fleet, { data: Object.assign({}, f, { maint: 'loading' }) });
    version += 1;
    pending.maintenance = Promise.resolve().then(function () { return avData.workOrders(call, f.core.serials); })
      .then(function (wo) { return { byAsset: wo.byAsset, failed: wo.failed }; }, function () { return { byAsset: {}, failed: 1 }; })
      .then(function (wo) {
        var cur = parts.fleet && parts.fleet.data;
        // A newer read of the fleet replaced it meanwhile: it asks for its own maintenance.
        if (cur && cur.core === f.core) {
          parts.fleet = Object.assign({}, parts.fleet, { data: fleetOf(cur.core, cur.requests, wo.byAsset, wo.failed ? 'partial' : 'ready', cur.today) });
          version += 1;
        }
        delete pending.maintenance;
        return parts.fleet && parts.fleet.data;
      });
    return pending.maintenance;
  }

  /**
   * What has been read: { version, requests (requestData's), fleet ({ model, serials, masterById, classes, notes,
   * maint: none | later | loading | ready | partial }), transfers ({ orders, history, orgs }), errors, pending }.
   * A part not read (yet, or for this role) or failed is null.
   */
  function snapshot() {
    var d = function (k) { return parts[k] ? parts[k].data : null; };
    var e = function (k) { return (parts[k] && parts[k].error) || ''; };
    return {
      version: version,
      requests: d('requests'), fleet: d('fleet'), transfers: d('transfers'),
      errors: { requests: e('requests'), fleet: e('fleet'), transfers: e('transfers') },
      pending: { requests: !!pending.requests, fleet: !!pending.fleet, transfers: !!pending.transfers, maintenance: !!pending.maintenance }
    };
  }

  /** Forget everything read (tests). */
  function reset() {
    parts = {};
    pending = {};
    stale = {};
    version += 1;
  }

  return { MAX_AGE: MAX_AGE, RETRY_MS: RETRY_MS, start: start, needs: needs, ensure: ensure, startMaintenance: startMaintenance, snapshot: snapshot, reset: reset };
});
