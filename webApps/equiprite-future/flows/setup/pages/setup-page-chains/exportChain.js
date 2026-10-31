define(['vb/action/actionChain', 'resources/js/exportKit', 'resources/js/shellBus', 'resources/js/future/fxSetup'], (ActionChain, exportKit, bus, fxSetup) => {
  'use strict';

  // Exports one list of the setup as it is shown: Excel, CSV, PDF (print) or Copy. A failure stays on the page.
  class exportChain extends ActionChain {
    async run(context, { list, format }) {
      const pv = context.$page.variables;
      pv.exportOpen = '';
      const res = await exportKit.run(format, fxSetup.exportOf(list, pv.v));
      bus.toast(res.message, res.ok ? 'info' : 'error');
      pv.failure = res.ok ? '' : res.message;
    }
  }

  return exportChain;
});
