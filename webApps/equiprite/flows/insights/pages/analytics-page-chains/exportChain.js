define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Export CSV (the old ButtonActionChain): the rows of the active report as loaded, through the old page's
  // exportCSV (copied into the page module), so the file is the same in both apps.
  class exportChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      await $page.functions.exportCSV(v.analyticsActiveTab, {
        stock: v.stockRows,
        pending: v.pendingRows,
        onhand: v.onhandRows,
        util: v.utilExportRows,
      });
    }
  }

  return exportChain;
});
