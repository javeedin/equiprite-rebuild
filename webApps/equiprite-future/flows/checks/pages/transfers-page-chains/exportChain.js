define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/transferList',
  'resources/js/shellBus',
], (ActionChain, exportKit, list, bus) => {
  'use strict';

  // Exports the transfers as shown (chip, kind, search, order): Excel, CSV, PDF or rows to paste.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const chip = (v.chips || []).filter((c) => c.key === v.chip)[0];
      const kind = (v.kindChips || []).filter((c) => c.key === v.kind)[0];
      const res = await exportKit.run(format, {
        name: 'transfers',
        title: 'Transfers',
        subtitle: [chip ? chip.label : 'All', kind && kind.key !== 'all' ? kind.label : '', v.text ? '"' + v.text + '"' : ''].filter(Boolean).join(' · '),
        rows: v.shown,
        columns: list.exportColumns(),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
