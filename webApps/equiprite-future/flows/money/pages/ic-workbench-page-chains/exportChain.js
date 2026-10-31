define(['vb/action/actionChain', 'resources/js/exportKit', 'resources/js/shellBus', 'resources/js/future/fxMoney'], (ActionChain, exportKit, bus, money) => {
  'use strict';

  // Exports one list of the workbench as shown: Excel, CSV, PDF or rows to paste (the transactions one row per
  // accounting line).
  class exportChain extends ActionChain {
    async run(context, { format, list }) {
      const vars = context.$page.variables;
      vars.exportOpen = '';
      const res = await exportKit.run(format, money.exportSpec('workbench', list, vars.v));
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
