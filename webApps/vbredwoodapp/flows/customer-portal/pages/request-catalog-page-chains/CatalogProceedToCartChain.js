define([
  'vb/action/actionChain',
  'vb/action/actions',
], function(ActionChain, Actions) {
  'use strict';

  class CatalogProceedToCartChain extends ActionChain {
    async run(context) {
      await Actions.navigateToPage(context, { page: 'request-cart' });
    }
  }

  return CatalogProceedToCartChain;
});
