define(['vb/action/actionChain', 'resources/js/future/fxOps', 'resources/js/exportKit', 'resources/js/shellBus'], (ActionChain, fxOps, exportKit, bus) => {
  'use strict';

  // Export: without a format, opens or closes a list's menu (data-list: toReceive, onHire, or hours:<lineId> for one
  // unit's days); with one, exports that list as shown as Excel, CSV, PDF or rows to paste, and toasts how it went.
  class exportChain extends ActionChain {
    async run(context, { list, format }) {
      const $v = context.$page.variables;
      if (!format) { $v.exportOpen = $v.exportOpen === list ? '' : (list || ''); return; }
      $v.exportOpen = '';
      const res = await exportKit.run(format, fxOps.exportSpec($v.v, list));
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
