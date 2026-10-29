define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class CloseBulkDialogChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.bulkProgressDialogOpen = false;
      $page.variables.showBulkSummary = false;
    }
  }

  return CloseBulkDialogChain;
});
