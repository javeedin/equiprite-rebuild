define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/customerPortal',
], (ActionChain, Actions, portal) => {
  'use strict';

  // Billing. Two reads, in parallel, both made by Old EquipRite's portal:
  //   views/customer-my-requests (page 0, size 200): the old customer-my-billing-page-chains/BilledRequestInitChain.js
  //     list, the requests with a contract number, mapped the same way
  //   views/customer-my-billing (page 0, size 10000): the invoices, as the old customer-billing-detail page reads them
  //     (BillingDetailInitChain), mapped and totalled with its rules
  class billingInitChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isLoading = true;
      $page.variables.fetchError = '';
      try {
        const [result, billingResult] = await Promise.all([
          Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsCustomerMyRequests', uriParams: { page: 0, size: 200 } }),
          Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsCustomerMyBilling', uriParams: { page: 0, size: 10000 } }),
        ]);

        let billed = [];
        if (result && result.ok && result.body && Array.isArray(result.body.data)) {
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
            contractNumber:  r.contractNumber         || ''
          }));
          billed = mapped.filter((r) => r.contractNumber && String(r.contractNumber).trim() !== '');
        } else {
          $page.variables.fetchError = 'Your billed requests could not be loaded (HTTP ' + (result && result.status) + ').';
        }

        const invoiceRows = (billingResult && billingResult.ok && billingResult.body && Array.isArray(billingResult.body.data))
          ? billingResult.body.data : [];
        if (!billingResult || !billingResult.ok) {
          $page.variables.fetchError = 'Your invoices could not be loaded (HTTP ' + (billingResult && billingResult.status) + ').';
        }
        const invoices = portal.mapInvoices(invoiceRows, new Date());

        $page.variables.invoices = invoices;
        $page.variables.summary = $page.functions.totals(invoices);
        $page.variables.billed = $page.functions.summaries(billed, invoices);
      } catch (e) {
        console.error('[billingInitChain] failed', e);
        $page.variables.fetchError = 'Billing could not be loaded.';
      } finally {
        $page.variables.isLoading = false;
      }
    }
  }

  return billingInitChain;
});
