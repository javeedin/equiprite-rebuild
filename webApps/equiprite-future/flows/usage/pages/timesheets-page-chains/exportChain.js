define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/shellBus',
], (ActionChain, exportKit, bus) => {
  'use strict';

  // Exports the week as shown (typed values included, before they are saved) or the requests on site as shown, as
  // Excel, CSV, PDF or rows to paste.
  class exportChain extends ActionChain {
    async run(context, { format, what }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      v.exportOpen = false;
      let res;
      if (what === 'queue') {
        const kind = fns.queueChips(v.queue).filter((c) => c.key === v.queueKind)[0];
        res = await exportKit.run(format, {
          name: 'timesheets-requests',
          title: 'Requests on site',
          subtitle: [kind && kind.key !== 'all' ? kind.label : 'All', v.queueText ? '"' + v.queueText + '"' : ''].filter(Boolean).join(' · '),
          rows: fns.queueShown(v.queue, v.queueText, v.queueKind),
          columns: fns.queueColumns(),
        });
      } else {
        res = await exportKit.run(format, {
          name: 'timesheet-' + (v.requestNumber || 'week') + '-' + (v.weekStart || ''),
          title: 'Timesheet ' + (v.requestNumber || ''),
          subtitle: [fns.weekTitle(v.weekStart), v.projectName, fns.weekWord(v.headerStatus, v.rows)].filter(Boolean).join(' · '),
          rows: fns.exportRows(v.rows, v.edits),
          columns: fns.exportColumns(v.weekDays),
        });
      }
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
