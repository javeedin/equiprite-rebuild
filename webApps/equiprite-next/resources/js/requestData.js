define(['resources/js/rules'], function (rules) {
  'use strict';

  // Requests and the equipment on them, as every screen of EquipRite Next reads them (My work, Requests, the bell).
  //
  //   views/my-requests        one row per request; filter ALL for managers and administrators, Internal otherwise
  //                            (the same rule as Old and New EquipRite; the backend scopes the rows to the user)
  //   views/my-request-lines   one row per equipment line, with its own lineStatus and allocationStatus
  //
  // One load is shared for a short while (MAX_AGE), so opening several tabs does not fetch it again; refresh: true
  // forces a new one. A failed lines call leaves the requests usable (linesLoaded false).
  var MAX_AGE = 30000;
  var TRIES = 60;
  var GAP_MS = 50;
  var cache = null;
  var pending = null;

  function pick(r, names) {
    for (var i = 0; i < names.length; i++) {
      var v = r && r[names[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }

  /** One equipment line in one shape, from either view (my-request-lines, request-detail-lines). Raw fields kept. */
  function lineOf(raw, requestNumber) {
    var r = raw || {};
    var util = pick(r, ['utilPct', 'utilizationPct']);
    return Object.assign({}, r, {
      key: String(pick(r, ['lineId', 'id', 'eqrEquipmentRequestLineId']) || '') + ':' + (pick(r, ['lineNumber']) || '') + ':' + (pick(r, ['equipmentName']) || ''),
      requestNumber: String(pick(r, ['requestNumber']) || requestNumber || ''),
      lineNumber: pick(r, ['lineNumber']) || null,
      name: pick(r, ['equipmentName', 'name', 'itemName']) || 'Equipment',
      cls: pick(r, ['className', 'equipmentClass']) || '',
      qty: Number(pick(r, ['qty', 'quantity'])) || 1,
      lineStatus: String(pick(r, ['lineStatus', 'status', 'requestStatus']) || '').toUpperCase(),
      allocation: String(pick(r, ['allocationStatus', 'allocStatus']) || '').toUpperCase(),
      serial: pick(r, ['allocatedSerialNumber', 'allocatedSerial', 'serialNumber']) || '',
      start: String(pick(r, ['startDate', 'requestedStartDate']) || '').slice(0, 10),
      end: String(pick(r, ['endDate', 'requestedEndDate']) || '').slice(0, 10),
      location: pick(r, ['deploymentLocation', 'location']) || '',
      util: util !== undefined && !isNaN(Number(util)) ? Math.max(0, Math.min(100, Math.round(Number(util)))) : null
    });
  }

  /** Lines grouped by request number, in line order. */
  function indexLines(rawLines) {
    var out = {};
    (Array.isArray(rawLines) ? rawLines : []).forEach(function (raw) {
      var l = lineOf(raw);
      if (!l.requestNumber) return;
      (out[l.requestNumber] = out[l.requestNumber] || []).push(l);
    });
    Object.keys(out).forEach(function (k) { out[k].sort(function (a, b) { return Number(a.lineNumber || 0) - Number(b.lineNumber || 0); }); });
    return out;
  }

  function waitForRoles(vars) {
    var i = 0;
    return new Promise(function (resolve) {
      (function tick() {
        if (vars.sessionRolesLoaded || i++ >= TRIES) resolve();
        else setTimeout(tick, GAP_MS);
      }());
    });
  }

  /**
   * { rows (newest first), linesByRequest, linesLoaded, manager, error, at }.
   * context, Actions: the calling chain's; opts.refresh skips the shared copy.
   */
  function load(context, Actions, opts) {
    var o = opts || {};
    if (!o.refresh && cache && Date.now() - cache.at < MAX_AGE) return Promise.resolve(cache);
    if (!o.refresh && pending) return pending;
    var vars = context.$application.variables;
    pending = waitForRoles(vars).then(function () {
      var manager = rules.isManager(vars.fusionRoles, vars.sessionRoles);
      return Promise.all([
        Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsMyRequests', uriParams: { size: 2000, filter: manager ? 'ALL' : 'Internal' } }),
        Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsMyRequestLines', uriParams: { page: 0, size: 10000 } })
          .catch(function () { return null; })
      ]).then(function (res) {
        var reqs = res[0];
        var lines = res[1];
        if (!reqs || !reqs.ok) {
          return { rows: [], linesByRequest: {}, linesLoaded: false, manager: manager, at: Date.now(),
            error: 'Requests could not be loaded (HTTP ' + (reqs && reqs.status) + ').' };
        }
        var rows = (reqs.body && Array.isArray(reqs.body.data)) ? reqs.body.data.slice() : [];
        rows.sort(function (a, b) { return Number(b.eqrEquipmentRequestId || 0) - Number(a.eqrEquipmentRequestId || 0); });
        var ok = !!(lines && lines.ok);
        cache = { rows: rows, linesByRequest: indexLines(ok && lines.body && Array.isArray(lines.body.data) ? lines.body.data : []),
          linesLoaded: ok, manager: manager, error: '', at: Date.now() };
        return cache;
      });
    }).catch(function (e) {
      console.error('[requestData] load failed', e);
      return { rows: [], linesByRequest: {}, linesLoaded: false, manager: false, error: 'Requests could not be loaded.', at: Date.now() };
    }).then(function (result) {
      pending = null;
      return result;
    });
    return pending;
  }

  // Who wants to know that the requests changed (the shell, for the cart's count of drafts).
  var listeners = [];

  /** Forget the shared copy (after a change, so every screen loads fresh), and say so to whoever listens. */
  function invalidate() {
    cache = null;
    listeners.forEach(function (fn) { try { fn(); } catch (e) { /* a listener's own problem */ } });
  }

  /** fn() after every change to the requests (invalidate). */
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  return { load: load, invalidate: invalidate, onChange: onChange, lineOf: lineOf, indexLines: indexLines, MAX_AGE: MAX_AGE };
});
