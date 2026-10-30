define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/approvalQueue',
  'resources/js/shellBus',
], (ActionChain, exportKit, queue, bus) => {
  'use strict';

  // Exports the queue as shown (its chip, source and search; most urgent first), as Excel, CSV, PDF or rows to paste.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const chip = (v.chips || []).filter((c) => c.key === v.stage)[0];
      const res = await exportKit.run(format, {
        name: 'approve-allocate',
        title: 'Approve & allocate',
        subtitle: [chip && chip.key !== 'all' ? chip.label : 'Everything waiting', v.source === 'EXTERNAL' ? 'Customer' : (v.source === 'INTERNAL' ? 'Project' : ''),
          v.text ? '"' + v.text + '"' : ''].filter(Boolean).join(' · '),
        rows: v.shown,
        columns: queue.exportColumns(),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
