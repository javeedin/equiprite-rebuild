define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class closeTransactionDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isTransactionDrawerOpen = false;
    }
  }

  return closeTransactionDrawerChain;
});
