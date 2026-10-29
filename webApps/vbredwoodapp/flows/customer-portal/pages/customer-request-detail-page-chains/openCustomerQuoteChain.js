define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Open the customer quote page for the request currently on screen — the
  // in-page route to the quote, so the customer doesn't have to go back to
  // My Requests to reach it.
  //
  // customer-quote resolves requestNumericId itself when absent (QuoteInitChain
  // matches on requestNumber), so requestId alone is enough — but we pass both
  // when we have them to skip that lookup.
  class openCustomerQuoteChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const requestId = $page.variables.requestId;
      const numericId = $page.variables.requestNumericId;

      if (!requestId && numericId == null) {
        console.warn('[openCustomerQuoteChain] No request identifiers — cannot open quote.');
        return;
      }

      await Actions.navigateToPage(context, {
        page: 'customer-quote',
        params: {
          requestId:        requestId || '',
          requestNumericId: numericId != null ? Number(numericId) : null
        }
      });
    }
  }

  return openCustomerQuoteChain;
});
