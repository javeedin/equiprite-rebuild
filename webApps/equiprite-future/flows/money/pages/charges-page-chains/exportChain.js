define(['vb/action/actionChain', 'resources/js/exportKit', 'resources/js/shellBus', 'resources/js/future/fxMoney'], (ActionChain, exportKit, bus, money) => {
  'use strict';

  // Exports one list as shown (its period filter, its order): Excel, CSV, PDF or rows to paste.
  class exportChain extends ActionChain {
    async run(context, { format, list }) {
      const vars = context.$page.variables;
      vars.exportOpen = '';
      const res = await exportKit.run(format, money.exportSpec('charges', list, vars.v));
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
