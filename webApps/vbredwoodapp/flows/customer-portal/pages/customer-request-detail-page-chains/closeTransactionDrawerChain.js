define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class closeTransactionDrawerChain extends ActionChain {
    async run(context) {
      context.$page.variables.isTransactionDrawerOpen = false;
    }
  }

  return closeTransactionDrawerChain;
});
