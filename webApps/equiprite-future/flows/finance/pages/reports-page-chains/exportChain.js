define(['vb/action/actionChain', 'resources/js/exportKit', 'resources/js/shellBus', 'resources/js/future/fxFinance'], (ActionChain, exportKit, bus, fxFinance) => {
  'use strict';

  // Exports one report as it is shown: Excel, CSV, PDF (print) or Copy. A failure is toasted and stays on the page.
  class exportChain extends ActionChain {
    async run(context, { list, format }) {
      const pv = context.$page.variables;
      pv.exportOpen = '';
      const res = await exportKit.run(format, fxFinance.exportOf(list, pv.v));
      bus.toast(res.message, res.ok ? 'info' : 'error');
      pv.failure = res.ok ? '' : res.message;
    }
  }

  return exportChain;
});
