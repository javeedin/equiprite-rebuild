define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // "Show more" under the invoices.
  class moreChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.invoiceLimit = ($page.variables.invoiceLimit || 25) + 25;
    }
  }

  return moreChain;
});
