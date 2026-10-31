define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/portalView',
  'resources/js/shellBus',
], (ActionChain, exportKit, V, bus) => {
  'use strict';

  // Exports every invoice of this request, with its piece of equipment.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const h = v.head || {};
      const res = await exportKit.run(format, {
        name: 'invoices-' + (h.requestNumber || 'request'),
        title: 'Invoices of ' + (h.requestNumber || ''),
        subtitle: [h.customerName, h.contractNumber ? 'Contract ' + h.contractNumber : '', 'Still to pay ' + ((v.totals && v.totals.outstandingAmount) || 0)]
          .filter(Boolean).join(' · '),
        rows: v.rows,
        columns: V.exportColumns('invoices'),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
