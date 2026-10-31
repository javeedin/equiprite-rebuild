define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/requestList',
  'resources/js/shellBus',
], (ActionChain, exportKit, list, bus) => {
  'use strict';

  // Exports what the current view shows (its filter, its order), as Excel, CSV, PDF or rows to paste.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const chip = (v.chips || []).filter((c) => c.key === v.stage)[0];
      const what = v.view === 'equipment' ? 'Equipment on requests' : 'Requests';
      const res = await exportKit.run(format, {
        name: v.view === 'equipment' ? 'request-equipment' : 'requests',
        title: what,
        subtitle: [chip && chip.key !== 'all' ? chip.label : 'All', v.source === 'EXTERNAL' ? 'Customer' : (v.source === 'INTERNAL' ? 'Project' : ''),
          v.text ? '"' + v.text + '"' : ''].filter(Boolean).join(' · '),
        rows: v.shown,
        columns: list.exportColumns(v.view),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
