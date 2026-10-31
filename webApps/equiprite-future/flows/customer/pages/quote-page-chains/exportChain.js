define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/portalView',
  'resources/js/shellBus',
], (ActionChain, exportKit, V, bus) => {
  'use strict';

  // Exports the quote's lines and its total.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const q = v.quote || {};
      const rows = (q.lines || []).concat([{ equipmentName: 'Total', equipmentClass: '', quantity: '', startDate: '', endDate: '', billRate: '', lineTotal: q.grandTotal }]);
      const res = await exportKit.run(format, {
        name: 'quote-' + (q.requestNumber || 'request'),
        title: 'Quote for ' + (q.requestNumber || ''),
        subtitle: [q.customerName, v.state && v.state.pill, q.contractNumber ? 'Contract ' + q.contractNumber : ''].filter(Boolean).join(' · '),
        rows,
        columns: V.exportColumns('quote'),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
