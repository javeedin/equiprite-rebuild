define(['vb/action/actionChain', 'resources/js/exportKit', 'resources/js/future/fxRequests', 'resources/js/shellBus'], (ActionChain, exportKit, fxReq, bus) => {
  'use strict';

  // Exports the units offered for the class and dates, as shown (owner, relationship, price, estimate, why not).
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const pv = context.$page.variables;
      pv.exportOpen = false;
      const res = await exportKit.run(format, fxReq.exportOf('options', pv.v));
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
