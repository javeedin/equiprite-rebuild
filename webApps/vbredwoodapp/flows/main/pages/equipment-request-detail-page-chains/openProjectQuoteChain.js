define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Open the project quote page for the request currently on screen — the
  // in-page route to the quote, so the approver doesn't have to go back to the
  // requests list to reach it.
  class openProjectQuoteChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const numericId = $page.variables.requestNumericId;

      if (numericId == null) {
        console.warn('[openProjectQuoteChain] No requestNumericId — cannot open quote.');
        return;
      }

      await Actions.navigateToPage(context, {
        page: 'project-quote',
        params: {
          requestId:        $page.variables.requestId || '',
          requestNumericId: Number(numericId)
        }
      });
    }
  }

  return openProjectQuoteChain;
});
