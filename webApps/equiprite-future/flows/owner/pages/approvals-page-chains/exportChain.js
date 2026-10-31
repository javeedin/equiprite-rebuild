define(['vb/action/actionChain', 'resources/js/future/fxOps', 'resources/js/exportKit', 'resources/js/shellBus'], (ActionChain, fxOps, exportKit, bus) => {
  'use strict';

  // Export: without a format, opens or closes the list's menu (data-list); with one, exports the list as shown (its
  // chip) as Excel, CSV, PDF or rows to paste, and toasts how it went.
  class exportChain extends ActionChain {
    async run(context, { list, format }) {
      const $v = context.$page.variables;
      if (!format) { $v.exportOpen = $v.exportOpen === list ? '' : (list || ''); return; }
      $v.exportOpen = '';
      const spec = fxOps.exportSpec($v.v, list, { rel: $v.rel });
      const res = await exportKit.run(format, spec);
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
