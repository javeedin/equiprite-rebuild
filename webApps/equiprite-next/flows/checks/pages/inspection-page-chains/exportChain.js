define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/inspectionQueue',
  'resources/js/shellBus',
], (ActionChain, exportKit, Q, bus) => {
  'use strict';

  // Exports the queue as shown (its chip, its search, its order): Excel, CSV, PDF or rows to paste.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const chip = (v.chips || []).filter((c) => c.key === v.chip)[0];
      const res = await exportKit.run(format, {
        name: 'inspections',
        title: 'Inspections',
        subtitle: [chip ? chip.label : 'Everything waiting', v.scope === 'all' ? 'every unit waiting' : 'asked for by the inspection matrix',
          v.text ? '"' + v.text + '"' : ''].filter(Boolean).join(' · '),
        rows: v.shown,
        columns: Q.exportColumns(),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
