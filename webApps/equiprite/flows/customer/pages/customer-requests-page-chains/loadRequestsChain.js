define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The customer's requests: Old EquipRite's customer-my-requests-page-chains/EquipmentRequestInitChain.js, same
  // endpoint and parameters (views/customer-my-requests, page 0, size 200) and the same row mapping. Newest first.
  // The view is scoped to the signed-in customer server-side.
  class loadRequestsChain extends ActionChain {
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
        const result = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsCustomerMyRequests',
          uriParams: { page: 0, size: 200 },
        });
        if (result && result.ok && result.body && result.body.data) {
          const mapped = result.body.data.map((r) => ({
            id:              r.eqrEquipmentRequestId || r.rowId,
            requestNumber:   r.requestNumber         || '',
            customerName:    r.customerName          || '',
            customerContact: r.customerContact       || '',
            agreementType:   r.agreementType         || '',
            status:          r.requestStatus         || '',
            startDate:       r.startDate  ? r.startDate.substring(0, 10)  : '',
            endDate:         r.endDate    ? r.endDate.substring(0, 10)    : '',
            lines:           r.lines      || 0,
            createdDate:     r.createdDate ? r.createdDate.substring(0, 10) : '',
            contractNumber:  r.contractNumber         || '',
          }));
          mapped.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
          $page.variables.allRows = mapped;
        } else {
          $page.variables.allRows = [];
          $page.variables.fetchError = 'Your requests could not be loaded (HTTP ' + (result && result.status) + ').';
        }
      } catch (e) {
        console.error('[loadRequestsChain] failed', e);
        $page.variables.allRows = [];
        $page.variables.fetchError = 'Your requests could not be loaded.';
      } finally {
        $page.variables.isLoading = false;
      }
    }
  }

  return loadRequestsChain;
});
