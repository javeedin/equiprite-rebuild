define([
  'vb/action/actionChain',
  'resources/js/exportKit',
  'resources/js/agreementRules',
  'resources/js/shellBus',
], (ActionChain, exportKit, A, bus) => {
  'use strict';

  // Exports the agreement's lines the search shows, with their rates, as Excel, CSV, PDF or rows to paste.
  class exportChain extends ActionChain {
    async run(context, { format }) {
      const v = context.$page.variables;
      v.exportOpen = false;
      const res = await exportKit.run(format, {
        name: 'agreement-' + (v.agreementNumber || 'lines'),
        title: 'Agreement ' + (v.agreementNumber || '') + (v.agreementName ? ' · ' + v.agreementName : ''),
        subtitle: [v.customerName, A.statusLabel(v.agreementStatus), v.searchText ? '"' + v.searchText + '"' : ''].filter(Boolean).join(' · '),
        rows: A.filterLines(v.linesArray, v.searchText),
        columns: A.linesExportColumns(),
      });
      bus.toast(res.message, res.ok ? 'info' : 'error');
    }
  }

  return exportChain;
});
