define(['resources/js/yardWork'], function (yw) {
  'use strict';

  // What the yard screens read, and nothing else (no writes here):
  //   1. the queue: views/workbench-requests?stage=INITIATE | RETURN&size=1000 (New's InitPickingQueueChain)
  //   2. each queued request's lines: views/request-detail-lines?requestId&page=0&size=500 (the request tab's call),
  //      a few at a time
  //   3. the yard each open line ships from or goes back to: views/line-detail-units?requestId&lineId&size=10000
  //      (New's openPickingDrawerChain call; its yard rule is yardWork.yardOfUnits), a few at a time, after the list
  //      is on screen, reported in batches so the list fills in as they arrive.
  var AT_ONCE = 6;

  function message(res, what) {
    return (res && res.body && res.body.message) || ('HTTP ' + (res && res.status) + ' loading ' + what + '.');
  }

  /** { ok, rows, error } for 'picking' or 'returns'. */
  function queue(context, Actions, kind) {
    var call = yw.QUEUE[kind];
    return Actions.callRest(context, { endpoint: call.endpoint, uriParams: Object.assign({}, call.uriParams) }).then(function (res) {
      if (!res || !res.ok) return { ok: false, rows: [], error: message(res, kind === 'picking' ? 'what has to go out' : 'what is coming back') };
      var isExternal = context.$application.functions.isExternalSource;
      return { ok: true, rows: yw.queueRows((res.body && res.body.data) || [], isExternal), error: '' };
    }, function (e) {
      return { ok: false, rows: [], error: (e && e.message) || 'Network error loading the queue.' };
    });
  }

  /** { linesBy: { requestId: rows | null }, failed: n } for the records. */
  function lines(context, Actions, records) {
    var linesBy = {};
    var failed = 0;
    return yw.pool(records || [], AT_ONCE, function (r) {
      return Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
        uriParams: { requestId: Number(r.eqrEquipmentRequestId || r.id), page: 0, size: 500 }
      }).then(function (res) {
        if (res && res.ok) linesBy[r.id] = (res.body && Array.isArray(res.body.data)) ? res.body.data : [];
        else { linesBy[r.id] = null; failed += 1; }
      }, function () { linesBy[r.id] = null; failed += 1; });
    }).then(function () { return { linesBy: linesBy, failed: failed }; });
  }

  /**
   * Looks up the yard of each { requestId, lineId }; onBatch({ lineId: yard }) is called every few answers and at the
   * end; stop() returning true ends it early (a newer load started). A failed lookup leaves the yard unknown.
   */
  function yards(context, Actions, lookups, onBatch, stop) {
    var batch = {};
    var count = 0;
    var flush = function () {
      if (!Object.keys(batch).length) return Promise.resolve();
      var out = batch;
      batch = {};
      return Promise.resolve(onBatch(out));
    };
    return yw.pool(lookups || [], AT_ONCE, function (q) {
      if (stop && stop()) return null;
      return Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsLineDetailUnits',
        uriParams: { requestId: Number(q.requestId), lineId: Number(q.lineId), size: 10000 }
      }).then(function (res) {
        if (res && res.ok) batch[q.lineId] = yw.yardOfUnits((res.body && res.body.data) || []);
        count += 1;
        if (count % 8 === 0 && !(stop && stop())) return flush();
        return null;
      }, function () { return null; });
    }).then(function () { return (stop && stop()) ? null : flush(); });
  }

  return { queue: queue, lines: lines, yards: yards, AT_ONCE: AT_ONCE };
});
