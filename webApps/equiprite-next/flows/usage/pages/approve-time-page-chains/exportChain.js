define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, exportKit, bus) => {
  'use strict';

  // Exports the lines as shown (week, status, search, "needs a look only"), with what needs a look and any adjustment.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      v.exportOpen = false;
      const shown = fns.shown(v.rowsAll, v.weekKey, v.statusKey, v.searchText, v.onlyLook, v.weekDays);
      const chip = fns.statusChips(v.rowsAll, v.weekKey).filter((c) => c.key === v.statusKey)[0];
      const res = await exportKit.run(format, {
        name: 'approve-time-' + (v.weekKey || 'week'),
        title: 'Hours to approve',
        subtitle: [v.weekKey ? 'Week of ' + fns.weekLabel(v.weekKey) : '', chip ? chip.label : '', v.onlyLook ? 'Needs a look only' : '',
          v.searchText ? '"' + v.searchText + '"' : ''].filter(Boolean).join(' · '),
        rows: fns.exportRows(shown, v.rowsAll, v.weekDays, v.auditByEntry),
        columns: fns.exportColumns(v.weekDays),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
