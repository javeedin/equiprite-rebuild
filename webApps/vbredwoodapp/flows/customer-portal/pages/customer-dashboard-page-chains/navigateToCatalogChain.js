define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // "New Request" primary action — opens the customer-create-req wizard,
  // not the catalog (catalog is reached via the secondary action).
  class navigateToCatalogChain extends ActionChain {

    async run(context) {
      await Actions.navigateToPage(context, { page: 'customer-create-req' });
    }
  }

  return navigateToCatalogChain;
});
