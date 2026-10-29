define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (ActionChain, Actions, _au) => {
  'use strict';

  /**
   * Cancel/close the Purchase Requisition drawer. Clears the transient state so
   * the next open starts clean. No server interaction. The drawer is an
   * oj-drawer-popup bound to $variables.isPrDrawerOpen — set it false to close
   * (was a DOM #prDialog.close() when this was an oj-dialog).
   */
  class ClosePrDialogChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isPrDrawerOpen = false;
      $page.variables.prSubmitting = false;
      $page.variables.prLines = [];
    }
  }

  return ClosePrDialogChain;
});
