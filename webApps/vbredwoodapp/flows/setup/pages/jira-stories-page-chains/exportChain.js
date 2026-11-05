define([
  'vb/action/actionChain',
  'vb/action/actions'
], (ActionChain, Actions) => {
  'use strict';

  // Export to Excel (format 'xls') or CSV ('csv'): the rows the table shows, every column jiraBacklog.exportColumns
  // names (what the page shows and what it found: checks failed, tester gaps, criteria, link).
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const { $page } = context;
      const v = $page.variables;
      const F = $page.functions;
      const rows = JSON.parse(JSON.stringify(v.shownRows || []));
      if (!rows.length) return;
      const file = F.exportFile(rows, format === 'xls' ? 'xls' : 'csv', F.today());
      F.download(file);
      await Actions.fireNotificationEvent(context, {
        summary: 'Exported', message: rows.length + (rows.length === 1 ? ' item' : ' items') + ' to ' + file.name + '.',
        displayMode: 'transient', type: 'confirmation'
      });
    }
  }

  return exportChain;
});
