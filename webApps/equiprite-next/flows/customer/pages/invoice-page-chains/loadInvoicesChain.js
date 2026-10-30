define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rules',
  'resources/js/customerPortal',
  'resources/js/portalView',
  'resources/js/shellBus',
], (ActionChain, Actions, rules, portal, V, bus) => {
  'use strict';

  // One request's invoices: New's invoice page reads (invoiceInitChain), in the same order:
  //   1 views/customer-request-details (page 0, size 10000): the header row for this request
  //   2 views/request-detail-lines (requestId, size 10000) and views/customer-my-billing (page 0, size 10000), in parallel
  // Invoices are grouped by request line and totalled with the old billing detail's rules (customerPortal). Billing is
  // withdrawn while EXTERNAL_PROJECT_ASSIGN_ENABLED is on (New's billing guard): then nothing is read. Next's guard: only
  // a request the customer's own view returned is read. Nothing is written.
  const TRIES = 60;
  const GAP_MS = 50;

  class loadInvoicesChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      const app = $application.variables;
      v.isLoading = true;
      v.error = '';
      v.exportOpen = false;
      for (let i = 0; i < TRIES && !app.flagsLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      v.billingShown = !!rules.isFeatureFlagOff(app.featureFlags, app.flagsLoaded, 'EXTERNAL_PROJECT_ASSIGN_ENABLED');
      try {
        if (!v.billingShown) {
          v.error = 'Billing for external requests is handled through the assigned project.';
          return;
        }
        const number = String(v.number || '');
        const given = Number(v.id) || 0;
        const headerResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsCustomerRequestDetails',
          uriParams: { page: 0, size: 10000 },
        });
        const rows = headerResult && headerResult.ok && headerResult.body && Array.isArray(headerResult.body.data) ? headerResult.body.data : null;
        if (!rows) {
          v.error = 'Your invoices could not be loaded (HTTP ' + (headerResult && headerResult.status) + ').';
          return;
        }
        const first = V.findOwn(rows, number, given);
        const id = first && first.eqrEquipmentRequestId != null ? Number(first.eqrEquipmentRequestId) : (first ? given : 0);
        if (!first || !id) {
          v.error = 'Request ' + (number || given) + ' could not be found among yours.';
          return;
        }
        v.requestId = id;

        const [linesResult, billingResult] = await Promise.all([
          Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsRequestDetailLines', uriParams: { requestId: id, size: 10000 } }),
          Actions.callRest(context, { endpoint: 'eqp-v1/getEquipriteV1ViewsCustomerMyBilling', uriParams: { page: 0, size: 10000 } }),
        ]);
        if (!billingResult || !billingResult.ok) {
          v.error = 'Your invoices could not be loaded (HTTP ' + (billingResult && billingResult.status) + ').';
          return;
        }
        const lineRows = linesResult && linesResult.ok && linesResult.body && Array.isArray(linesResult.body.data) ? linesResult.body.data : [];
        const billingRows = Array.isArray(billingResult.body && billingResult.body.data) ? billingResult.body.data : [];
        const groups = V.invoiceGroups(lineRows, billingRows, id, new Date());
        const all = [];
        groups.forEach((g) => g.invoices.forEach((i) => all.push(i)));
        const head = Object.assign(V.headerOf(first, number), { id });
        v.totals = portal.invoiceTotals(all);
        v.rows = all.map((i) => Object.assign({}, i, { requestNumber: head.requestNumber, contractNumber: head.contractNumber }));
        v.groups = groups;
        v.head = head;
        bus.rename('invoice:' + (v.id || v.number), 'Invoices · ' + head.requestNumber);
      } catch (e) {
        console.error('[customer loadInvoicesChain] failed', e);
        v.error = 'The invoices could not be loaded.';
      } finally {
        v.isLoading = false;
      }
    }
  }

  return loadInvoicesChain;
});
