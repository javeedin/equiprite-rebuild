define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/agreementRules',
  'resources/js/shellBus',
], (ActionChain, exportKit, A, bus) => {
  'use strict';

  // Exports the agreements shown (the chip, the search, the order) as Excel, CSV, PDF or rows to paste.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const chip = (v.chips || []).filter((c) => c.key === v.chip)[0];
      const res = await exportKit.run(format, {
        name: 'agreements',
        title: 'Rental agreements',
        subtitle: [chip && chip.key !== 'all' ? chip.label : 'All', v.text ? '"' + v.text + '"' : ''].filter(Boolean).join(' · '),
        rows: v.shown || [],
        columns: A.listExportColumns(),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
