define(['vb/action/actionChain', 'resources/js/exportKit', 'resources/js/future/fxRequests', 'resources/js/shellBus'], (ActionChain, exportKit, fxReq, bus) => {
  'use strict';

  // Exports the requests as shown (chip, search, order): Excel, CSV, PDF or rows to paste.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const pv = context.$page.variables;
      pv.exportOpen = false;
      const res = await exportKit.run(format, fxReq.exportOf('requests', pv.v));
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
