define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Export CSV, as the old timesheet-detail exportCsvChain: the week on screen (typed values included), downloaded as
  // Timesheet_<request>_<week>.csv.
  class exportCsvChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      if (!(v.rows || []).length) return;
      const csv = $page.functions.csv(v.rows, v.edits, v.weekDays);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', 'Timesheet_' + (v.requestNumber || 'timesheet') + '_' + (v.weekStart || 'week') + '.csv');
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  }

  return exportCsvChain;
});
