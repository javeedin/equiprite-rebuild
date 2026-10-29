define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Open the Edit Line dialog for a row: seed the editLine* page variables from
  // the row's raw values (rate/dates), remember which row is being edited, then
  // open the oj-dialog by id. Mirrors the customer cart page's edit pattern.
  class OpenEditLineChain extends ActionChain {
    async run(context, { rowIndex }) {
      const { $page } = context;
      const idx = Number(rowIndex);
      const lines = $page.variables.linesArray || [];
      const line = lines[idx];
      if (!line) {
        console.warn('[OpenEditLineChain] no line at rowIndex', rowIndex);
        return;
      }

      $page.variables.editLineRowIndex  = idx;
      $page.variables.editLineRate       = Number(line.bill_rate_raw) || 0;
      $page.variables.editLineStartDate  = line.line_start_date_raw || '';
      $page.variables.editLineEndDate    = line.line_end_date_raw   || '';

      const dialog = document.getElementById('editLineDialog');
      if (dialog && typeof dialog.open === 'function') dialog.open();
    }
  }

  return OpenEditLineChain;
});
