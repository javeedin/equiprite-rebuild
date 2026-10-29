define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class submitTransactionChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      $page.variables.isTransactionDrawerOpen = false;

      const type = $page.variables.activeTransactionTab === '16a' ? 'Expense' : 'Material Issue';

      await Actions.fireNotificationEvent(context, {
        summary: 'Transaction Submitted',
        message: `${type} transaction has been successfully submitted to Oracle PPM.`,
        type: 'confirmation',
      });
    }
  }

  return submitTransactionChain;
});
