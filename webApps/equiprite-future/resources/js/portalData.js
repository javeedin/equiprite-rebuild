define(['resources/js/rules', 'resources/js/customerPortal', 'resources/js/portalView'], function (rules, portal, V) {
  'use strict';

  // What needs a customer, for the bell: the portal's own reads (New's customer views, scoped to the signed-in
  // customer server-side) and its own rule (portalView.needs: quotes to accept, deliveries to accept, drafts to send,
  // overdue invoices). The bell reads the lines of the newest MAX open requests only, to stay light.
  var MAX = 10;

  function rowsOf(res) { return res && res.ok && res.body && Array.isArray(res.body.data) ? res.body.data : null; }

  /** { needs: [...], error } — needs as portalView.needs returns them. */
  function load(context, Actions) {
    var app = context.$application.variables;
    var quotingAllowed = !!rules.isQuotingAllowed(app.globalSettings, app.flagsLoaded, 'CUSTOMER');
    var billingShown = !!rules.isFeatureFlagOff(app.featureFlags, app.flagsLoaded, 'EXTERNAL_PROJECT_ASSIGN_ENABLED');
    return Promise.all([
      Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsCustomerMyRequests', uriParams: { page: 0, size: 200 } }).catch(function () { return null; }),
      billingShown ? Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsCustomerMyBilling', uriParams: { page: 0, size: 10000 } }).catch(function () { return null; })
        : Promise.resolve(null)
    ]).then(function (res) {
      var data = rowsOf(res[0]);
      if (!data) return { needs: [], error: 'Your requests could not be checked.' };
      var requests = V.requestsOf(data);
      var read = V.toRead(requests, MAX);
      return Promise.all(read.map(function (r) {
        return Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines', uriParams: { requestId: Number(r.id), size: 10000 } })
          .catch(function () { return null; });
      })).then(function (lineRes) {
        var linesById = {};
        lineRes.forEach(function (lr, i) { var rows = rowsOf(lr); if (rows) linesById[String(read[i].id)] = V.linesOf(rows); });
        var billRows = rowsOf(res[1]);
        var invoices = billRows ? portal.mapInvoices(billRows, new Date()) : [];
        var billing = billingShown ? portal.invoiceTotals(invoices) : null;
        return { needs: V.needs(requests, linesById, billing, { quotingAllowed: quotingAllowed, overdueRequest: V.overdueRequest(invoices, requests) }), error: '' };
      });
    });
  }

  return { load: load, MAX: MAX };
});
