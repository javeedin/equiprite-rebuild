define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/customerPortal',
], (ActionChain, Actions, portal) => {
  'use strict';

  // Customer home. The reads of Old EquipRite's customer-dashboard-page-chains/CustomerDashboardInitChain.js, same
  // endpoints, parameters and order:
  //   1 views/customer-my-requests and views/customer-my-billing, in parallel (page 0, size 200)
  //   2 the lines of every request whose header is IN_PROCESS or QUOTE_ACCEPTED, in parallel (size 2000), and here also
  //     DEPLOYED: the old tile skipped those, so a request whose every line was on site counted none of them
  // From them: active requests (SUBMITTED / IN_PROCESS), equipment on site (DEPLOYED lines), the latest ten requests.
  // New here, from the same answers: lines that arrived (SHIP_TO_SITE) and wait for the customer to accept them, and
  // the invoice figures, read with the old billing detail's rules (customerPortal.invoiceTotals) rather than the old
  // dashboard's raw PENDING count, which no V237 invoice status matches.
  const ACTIVE_REQUEST_HEADER = ['SUBMITTED', 'IN_PROCESS'];
  const ACTIVE_HEADER = ['IN_PROCESS', 'QUOTE_ACCEPTED', 'DEPLOYED'];

  class homeInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const vars = $application.variables;
      $page.variables.isLoading = true;
      $page.variables.fetchError = '';
      for (let i = 0; i < 60 && !vars.flagsLoaded; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      $page.variables.quotingAllowed = !!$application.functions.isQuotingAllowed(vars.globalSettings, vars.flagsLoaded, 'CUSTOMER');
      try {
        const [requestsResult, invoicesResult] = await Promise.all([
          Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsCustomerMyRequests', uriParams: { page: 0, size: 200 } }),
          Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsCustomerMyBilling', uriParams: { page: 0, size: 200 } }),
        ]);
        if (!requestsResult || !requestsResult.ok) {
          $page.variables.fetchError = 'Your requests could not be loaded (HTTP ' + (requestsResult && requestsResult.status) + ').';
        }

        const requests = (requestsResult && requestsResult.ok && requestsResult.body && Array.isArray(requestsResult.body.data))
          ? requestsResult.body.data.map((r) => ({
            id:              r.eqrEquipmentRequestId || r.rowId,
            requestNumber:   r.requestNumber         || '',
            customerName:    r.customerName          || '',
            customerContact: r.customerContact       || '',
            agreementType:   r.agreementType         || '',
            status:          r.requestStatus         || '',
            startDate:       r.startDate    ? r.startDate.substring(0, 10)   : '',
            endDate:         r.endDate      ? r.endDate.substring(0, 10)     : '',
            lines:           r.lines        || 0,
            createdDate:     r.createdDate  ? r.createdDate.substring(0, 10) : '',
            contractNumber:  r.contractNumber || '',
            _createdRaw:     r.createdDate  || null,
          }))
          : [];

        const activeCount = requests.filter((r) => ACTIVE_REQUEST_HEADER.indexOf(r.status) !== -1).length;

        const inProcess = requests.filter((r) => ACTIVE_HEADER.indexOf(r.status) !== -1);
        const deployedById = {};
        const arrivedById = {};
        let deployedLineCount = 0;
        if (inProcess.length > 0) {
          const lineResults = await Promise.all(inProcess.map((r) => Actions.callRest(context, {
            endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
            uriParams: { requestId: r.id, size: 2000 },
          }).catch((e) => ({ ok: false, error: e }))));
          lineResults.forEach((res, i) => {
            if (res && res.ok && res.body && Array.isArray(res.body.data)) {
              const id = inProcess[i].id;
              deployedById[id] = res.body.data.filter((l) => l.lineStatus === 'DEPLOYED').length;
              arrivedById[id] = res.body.data.filter((l) => l.lineStatus === 'SHIP_TO_SITE').length;
              deployedLineCount += deployedById[id];
            }
          });
        }

        const invoiceRows = (invoicesResult && invoicesResult.ok && invoicesResult.body && Array.isArray(invoicesResult.body.data))
          ? invoicesResult.body.data : [];
        const totals = portal.invoiceTotals(portal.mapInvoices(invoiceRows, new Date()));
        const billingShown = !!$application.functions.isFeatureFlagOff(vars.featureFlags, vars.flagsLoaded, 'EXTERNAL_PROJECT_ASSIGN_ENABLED');

        const recent = requests.slice()
          .sort((a, b) => {
            const aT = a._createdRaw ? new Date(a._createdRaw).getTime() : 0;
            const bT = b._createdRaw ? new Date(b._createdRaw).getTime() : 0;
            return bT - aT;
          })
          .slice(0, 10)
          .map((r) => { const { _createdRaw, ...rest } = r; return rest; });

        // One customer across every request (the usual case for a customer sign-in): name them in the band.
        const names = Array.from(new Set(requests.map((r) => r.customerName).filter(Boolean)));

        $page.variables.kpis = {
          active: activeCount,
          total: requests.length,
          onSite: deployedLineCount,
          toPay: totals.outstandingAmount,
          openInvoices: totals.openCount,
          overdue: totals.overdueCount,
          overdueAmount: totals.overdueAmount,
        };
        $page.variables.customerName = names.length === 1 ? names[0] : '';
        $page.variables.recent = recent;
        $page.variables.onSite = $page.functions.onSite(requests, deployedById);
        $page.variables.todo = portal.todo(requests, arrivedById, billingShown ? totals : null,
          { quotingAllowed: $page.variables.quotingAllowed });
      } catch (e) {
        console.error('[homeInitChain] failed', e);
        $page.variables.fetchError = 'Your requests could not be loaded.';
      } finally {
        $page.variables.isLoading = false;
      }
    }
  }

  return homeInitChain;
});
