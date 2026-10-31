define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/portalView',
  'resources/js/shellBus',
], (ActionChain, exportKit, V, bus) => {
  'use strict';

  // Exports this request's equipment: what, how many, dates, rate, where it is. Never a serial number.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const h = v.head || {};
      const res = await exportKit.run(format, {
        name: h.requestNumber || 'request',
        title: 'Request ' + (h.requestNumber || ''),
        subtitle: [h.customerName, h.headline, h.contractNumber ? 'Contract ' + h.contractNumber : ''].filter(Boolean).join(' · '),
        rows: v.lines,
        columns: V.exportColumns('lines'),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
