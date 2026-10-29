define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/customerPortal',
], (ActionChain, Actions, portal) => {
  'use strict';

  // The invoices of one request: Old EquipRite's customer-billing-detail-page-chains/BillingDetailInitChain.js, same
  // reads and order:
  //   1 views/customer-request-details (page 0, size 10000): the header row for this request number
  //   2 views/request-detail-lines and views/customer-my-billing (page 0, size 10000), in parallel
  // Invoices are grouped by request line; the mapping and the banner totals are the old chain's, now in
  // resources/js/customerPortal.js (mapInvoice, invoiceTotals) so the billing list uses the same rules.
  class invoiceInitChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const requestId = (params && params.requestId) || $page.variables.requestId;
      let requestNumericId = (params && params.requestNumericId) || $page.variables.requestNumericId;
      $page.variables.isLoading = true;
      $page.variables.fetchError = '';

      if (!requestId) {
        console.error('[invoiceInitChain] No requestId found.');
        $page.variables.isLoading = false;
        $page.variables.fetchError = 'No request was given. Open it from Billing.';
        return;
      }

      try {
        // ── 1. Header ─────────────────────────────────────────────────────────
        const headerResult = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1ViewsCustomerRequestDetails',
          uriParams: { page: 0, size: 10000 }
        });

        let first = null;
        if (headerResult && headerResult.ok && headerResult.body && Array.isArray(headerResult.body.data)) {
          const matching = headerResult.body.data.filter((r) => r.requestNumber === requestId);
          if (matching.length > 0) {
            first = matching[0];
            if (!requestNumericId && first.eqrEquipmentRequestId != null) {
              requestNumericId = first.eqrEquipmentRequestId;
            }
          }
        }
        if (requestNumericId) $page.variables.requestNumericId = Number(requestNumericId);

        $page.variables.formData = {
          requestNumber:   (first && first.requestNumber)   || requestId,
          customerName:    (first && first.customerName)     || '',
          customerContact: (first && first.customerContact)  || '',
          status:          (first && first.requestStatus)    || '',
          startDate:       (first && first.startDate)  ? first.startDate.substring(0, 10)  : '',
          endDate:         (first && first.endDate)    ? first.endDate.substring(0, 10)    : '',
          location:        (first && (first.deploymentLocation || first.location)) || '',
          contractNumber:  (first && first.contractNumber)   || ''
        };

        if (!requestNumericId) {
          console.error('[invoiceInitChain] No requestNumericId — cannot load lines.');
          $page.variables.lines = [];
          $page.variables.fetchError = 'This request could not be found among yours.';
          return;
        }

        // ── 2. Lines + 3. Invoices (in parallel) ──────────────────────────────
        const [linesResult, billingResult] = await Promise.all([
          Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1ViewsRequestDetailLines',
            uriParams: { requestId: Number(requestNumericId), size: 10000 }
          }),
          Actions.callRest(context, {
            endpoint:  'eqp-v1/getEquipriteV1ViewsCustomerMyBilling',
            uriParams: { page: 0, size: 10000 }
          })
        ]);

        const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
        const invoicesByLine = {};
        if (billingResult && billingResult.ok && billingResult.body && Array.isArray(billingResult.body.data)) {
          billingResult.body.data
            .filter((r) => String(r.eqrEquipmentRequestId) === String(requestNumericId) && r.eqrRequestLineId != null)
            .forEach((r, i) => {
              const key = String(r.eqrRequestLineId);
              (invoicesByLine[key] = invoicesByLine[key] || []).push(portal.mapInvoice(r, key, i, today));
            });
          Object.keys(invoicesByLine).forEach((k) => { invoicesByLine[k].sort((a, b) => a._sort - b._sort); });
        }

        let lines = [];
        if (linesResult && linesResult.ok && linesResult.body && Array.isArray(linesResult.body.data)) {
          lines = linesResult.body.data.map((r, index) => {
            const lineId = String(r.lineId != null ? r.lineId : (r.id != null ? r.id : index + 1));
            const invoices = invoicesByLine[lineId] || [];
            const totalValue = invoices.reduce((s, inv) => s + (Number(inv.amount) || 0), 0);
            return {
              lineId:         lineId,
              equipmentName:  r.equipmentName  || '',
              equipmentClass: r.className      || r.equipmentClass || '',
              quantity:       r.quantity       != null ? r.quantity : '',
              billRate:       r.billRate       != null ? r.billRate : '',
              billFrequency:  r.billFrequency  || '',
              lineStatus:     r.lineStatus     || '',
              invoices:       invoices,
              invoiceCount:   invoices.length,
              totalValue:     totalValue,
              expanded:       index === 0
            };
          });
        }
        $page.variables.lines = lines;

        // ── 4. Banner figures (total invoiced / paid / outstanding / last / adjustments) ──
        const all = [];
        lines.forEach((ln) => { ln.invoices.forEach((inv) => all.push(inv)); });
        $page.variables.totals = portal.invoiceTotals(all);
      } catch (e) {
        console.error('[invoiceInitChain] failed', e);
        $page.variables.fetchError = 'The invoices could not be loaded.';
      } finally {
        $page.variables.isLoading = false;
      }
    }
  }

  return invoiceInitChain;
});
