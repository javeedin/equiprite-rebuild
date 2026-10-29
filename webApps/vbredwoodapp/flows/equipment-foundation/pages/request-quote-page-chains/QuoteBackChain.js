define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Back → return to the page that launched this quote. sourcePage is passed
  // in as a URL param by the launcher (today: request-detail's generateQuote
  // action); it defaults to 'request-detail' so a direct/deep-linked open
  // still has a safe Back target.
  class QuoteBackChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const target = $page.variables.sourcePage || 'request-detail';
      await Actions.navigateToPage(context, {
        page: target,
        params: {
          requestId:     $page.variables.requestId,
          requestNumber: $page.variables.requestNumber
        }
      });
    }
  }

  return QuoteBackChain;
});
