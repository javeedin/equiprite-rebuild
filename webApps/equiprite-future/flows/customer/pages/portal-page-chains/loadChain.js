define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rules',
  'resources/js/customerPortal',
  'resources/js/portalView',
], (ActionChain, Actions, rules, portal, V) => {
  'use strict';

  // The portal's reads, New's customer views with New's parameters:
  //   1 views/customer-my-requests (page 0, size 200), and views/customer-my-billing (page 0, size 10000, the billing
  //     page's read) while billing is shown (EXTERNAL_PROJECT_ASSIGN_ENABLED off, New's billing guard); in parallel
  //   2 views/request-detail-lines (requestId, size 10000: New's request page read) for the open requests among them,
  //     newest first, at most MAX: only requests the customer's own view returned are read, so nothing else of anyone
  //     else is ever asked for
  // The views are scoped to the signed-in customer server-side. Nothing is written.
  const TRIES = 60;
  const GAP_MS = 50;
  const MAX = 50;

  class loadChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      const app = $application.variables;
      v.isLoading = true;
      v.error = '';
      v.billingError = '';
      for (let i = 0; i < TRIES && !(app.flagsLoaded && app.pageAccessLoaded); i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      v.quotingAllowed = !!rules.isQuotingAllowed(app.globalSettings, app.flagsLoaded, 'CUSTOMER');
      v.billingShown = !!rules.isFeatureFlagOff(app.featureFlags, app.flagsLoaded, 'EXTERNAL_PROJECT_ASSIGN_ENABLED');
      v.canCreate = rules.pageAccess(app.pageAccessMap, app.pageAccessLoaded, 'EQR_CUST_CREATE_REQ') !== 'HIDDEN';
      v.behalf = !!portal.actsForCustomers(app.pageAccessMap, app.pageAccessLoaded);
      try {
        const [reqRes, billRes] = await Promise.all([
          Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsCustomerMyRequests', uriParams: { page: 0, size: 200 } }),
          v.billingShown
            ? Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsCustomerMyBilling', uriParams: { page: 0, size: 10000 } }).catch(() => null)
            : Promise.resolve(null),
        ]);
        const ok = !!(reqRes && reqRes.ok && reqRes.body && Array.isArray(reqRes.body.data));
        if (!ok) v.error = 'Your requests could not be loaded (HTTP ' + (reqRes && reqRes.status) + ').';
        const requests = ok ? V.requestsOf(reqRes.body.data) : [];

        const read = V.toRead(requests, MAX);
        const results = await Promise.all(read.map((r) => Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
          uriParams: { requestId: Number(r.id), size: 10000 },
        }).catch(() => null)));
        const linesById = {};
        let missed = 0;
        results.forEach((res, i) => {
          if (res && res.ok && res.body && Array.isArray(res.body.data)) linesById[String(read[i].id)] = V.linesOf(res.body.data);
          else missed += 1;
        });
        const open = requests.filter((r) => portal.groupOf(r.status) !== 'done').length;
        v.linesNote = missed
          ? 'The equipment of ' + missed + (missed === 1 ? ' request' : ' requests') + ' could not be read: open a request to see it.'
          : (open > read.length ? 'The equipment of your ' + read.length + ' newest open requests is shown; open an older request to see its own.' : '');

        let invoices = [];
        if (v.billingShown) {
          if (billRes && billRes.ok && billRes.body && Array.isArray(billRes.body.data)) invoices = portal.mapInvoices(billRes.body.data, new Date());
          else v.billingError = 'Your invoices could not be loaded (HTTP ' + (billRes && billRes.status) + ').';
        }
        v.linesById = linesById;
        v.invoiceBase = invoices;
        v.base = requests;
      } catch (e) {
        console.error('[customer loadChain] failed', e);
        v.error = 'Your requests could not be loaded.';
      } finally {
        v.isLoading = false;
      }
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return loadChain;
});
