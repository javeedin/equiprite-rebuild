define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class exportCsvChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const csv = $page.functions.getCsvData();
      if (!csv) {
        console.warn('[exportCsvChain] No data to export');
        return;
      }

      const requestId = $page.variables.requestId || 'timesheet';
      const weekStart = $page.variables.selectedWeekStart || 'week';
      const filename  = 'Timesheet_' + requestId + '_' + weekStart + '.csv';

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  }

  return exportCsvChain;
});
