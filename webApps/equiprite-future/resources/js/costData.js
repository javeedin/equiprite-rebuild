define(['resources/js/costPreview', 'resources/js/prPassThrough', 'resources/js/expenditureTypes'], function (CP, prPassThrough, expenditureTypes) {
  'use strict';

  // The reads behind Post costs in EquipRite Next, shared by the list and a request's tab. Reads only.
  //
  //   list(context, Actions)        New's listChain: views/post-cost (page 0, size 10000; one row per request x week)
  //                                 then the unfiltered misc charges (non-fatal), grouped by New's buildList. Shared
  //                                 for half a minute so a request's tab does not read it again; refresh reads anew.
  //   preview(context, Actions, r)  New's loadPreviewChain, read for read and in its order: views/post-cost-details,
  //                                 line-retier-weeks, blackout-weeks, misc-transactions, line-project-splits, then the
  //                                 purchase requisitions (the request id resolved from its number when the row has
  //                                 none). The companions are non-fatal, as in New. Not carried: New's expenditure-type
  //                                 list, which only feeds New's pickers.
  //   breakdown(context, Actions, r, misc)
  //                                 what the list shows per request (ready, posted, running): views/post-cost-details and
  //                                 the purchase requisitions, the only reads that change an amount, with the request's
  //                                 charges from the list's misc read; summed by New's buildPreview, so a request's
  //                                 figures on the list and in its tab are the same.
  var MAX_AGE = 30000;
  var cache = null;
  var pending = null;
  var rules = new CP.CostPreview();

  function bodyOf(context, Actions, endpoint, uriParams) {
    return Actions.callRest(context, { endpoint: endpoint, uriParams: uriParams }).then(function (r) {
      return r && r.ok ? r.body : null;
    }, function (e) {
      console.warn('[costData] ' + endpoint + ' not read (non-fatal):', e && e.message);
      return null;
    });
  }

  function list(context, Actions, opts) {
    var o = opts || {};
    if (!o.refresh && cache && Date.now() - cache.at < MAX_AGE) return Promise.resolve(cache);
    if (!o.refresh && pending) return pending;
    pending = Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsPostCost', uriParams: { page: 0, size: 10000 } })
      .then(function (res) {
        if (!res || !res.ok || !res.body || !Array.isArray(res.body.data)) {
          return { list: [], misc: [], at: Date.now(), error: 'The requests to post could not be loaded (HTTP ' + (res && res.status) + ').' };
        }
        return Actions.callRest(context, { endpoint: 'eqp-v1/getMiscTransactions', uriParams: { page: 0, size: 10000 } })
          .then(function (m) { return rules.arrOf(m && m.body); }, function (e) {
            console.warn('[costData] misc charges not read (non-fatal):', e && e.message);
            return [];
          })
          .then(function (misc) {
            cache = { list: rules.buildList(res.body.data, misc), misc: misc, error: '', at: Date.now() };
            return cache;
          });
      })
      .catch(function (e) {
        console.error('[costData] list failed', e);
        return { list: [], misc: [], at: Date.now(), error: 'The requests to post could not be loaded.' };
      })
      .then(function (result) {
        pending = null;
        return result;
      });
    return pending;
  }

  function prOf(body) {
    return { prLineIds: prPassThrough.parsePrLineIds(body), prPoPrices: prPassThrough.parsePrPoPrices(body) };
  }

  /** { out (buildPreview's), requestId, error }. row: a list row (or { requestNumber }). */
  async function preview(context, Actions, row) {
    var cur = row || {};
    var requestNumber = cur.requestNumber;
    if (!requestNumber) return { out: null, requestId: 0, error: 'No request to show.' };
    var callRest = function (o) { return Actions.callRest(context, o); };
    var res = await Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsPostCostDetails', uriParams: { requestNumber: requestNumber } });
    if (!res || !res.ok || !res.body || !Array.isArray(res.body.data)) {
      return { out: null, requestId: 0, error: 'The cost of ' + requestNumber + ' could not be loaded (HTTP ' + (res && res.status) + ').' };
    }
    var retier = await bodyOf(context, Actions, 'eqp-v1/getEquipriteV1ViewsLineRetierWeeks', { requestNumber: requestNumber });
    var blackout = await bodyOf(context, Actions, 'eqp-v1/getBlackoutWeeks', { requestNumber: requestNumber });
    var misc = await bodyOf(context, Actions, 'eqp-v1/getMiscTransactions', { requestNumber: requestNumber });
    var splits = await bodyOf(context, Actions, 'eqp-v1/getLineProjectSplits', { requestNumber: requestNumber });
    var pr = { prLineIds: {}, prPoPrices: {} };
    var rid = Number(cur.eqrEquipmentRequestId) || 0;
    if (!rid) rid = Number(await expenditureTypes.resolveRequestIdByNumber(callRest, requestNumber)) || 0;
    if (rid) pr = prOf(await bodyOf(context, Actions, 'eqp-v1/getPurchaseRequisitions', { requestId: rid, page: 0, size: 200 }));
    var out = rules.buildPreview(res.body.data, { retier: retier, blackout: blackout, misc: misc, splits: splits,
      prLineIds: pr.prLineIds, prPoPrices: pr.prPoPrices }, rules.hdrOf(cur));
    return { out: out, requestId: rid, error: '' };
  }

  /** The list's figures for one request, or null when its cost could not be read. */
  async function breakdown(context, Actions, row, misc) {
    var requestNumber = row && row.requestNumber;
    if (!requestNumber) return null;
    var res = await Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsPostCostDetails', uriParams: { requestNumber: requestNumber } })
      .catch(function () { return null; });
    if (!res || !res.ok || !res.body || !Array.isArray(res.body.data)) return null;
    var pr = { prLineIds: {}, prPoPrices: {} };
    var rid = Number(row.eqrEquipmentRequestId) || 0;
    if (rid) pr = prOf(await bodyOf(context, Actions, 'eqp-v1/getPurchaseRequisitions', { requestId: rid, page: 0, size: 200 }));
    var mine = (Array.isArray(misc) ? misc : []).filter(function (m) { return m && m.requestNumber === requestNumber; });
    var out = rules.buildPreview(res.body.data, { misc: mine, prLineIds: pr.prLineIds, prPoPrices: pr.prPoPrices }, rules.hdrOf(row));
    return rules.summarize(out);
  }

  function invalidate() { cache = null; }

  return { list: list, preview: preview, breakdown: breakdown, invalidate: invalidate, MAX_AGE: MAX_AGE };
});
