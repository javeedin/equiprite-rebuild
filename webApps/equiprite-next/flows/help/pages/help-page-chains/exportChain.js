define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, exportKit, bus) => {
  'use strict';

  // Exports every stored status and how it shows (Excel, CSV, PDF or rows to paste).
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      const res = await exportKit.run(format, {
        name: 'equiprite-statuses',
        title: 'Every status, and how it shows',
        subtitle: 'EquipRite Next: stored line status, its step in the flow, what the screens show, who is next',
        rows: v.statuses,
        columns: [
          { key: 'code', label: 'Stored status' }, { key: 'step', label: 'Step' }, { key: 'stageLabel', label: 'Stage' },
          { key: 'label', label: 'Shown as' }, { key: 'next', label: 'Who is next' },
        ],
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
