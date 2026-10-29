define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class navigateToCatalogChain extends ActionChain {
    async run(context) {
      await Actions.navigateToPage(context, { page: 'customer-create-req' });
    }
  }

  return navigateToCatalogChain;
});

