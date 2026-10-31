define(['vb/action/actionChain', 'resources/js/exportKit', 'resources/js/future/fxRequests', 'resources/js/shellBus'], (ActionChain, exportKit, fxReq, bus) => {
  'use strict';

  // Exports what the tab shown lists: the equipment lines, the charges, the accounting lines or the history.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const pv = context.$page.variables;
      pv.exportOpen = false;
      const res = await exportKit.run(format, fxReq.exportOf(pv.tab, pv.v));
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
