define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Open the project quote page for one row of the requests list.
  //
  // rowData is forwarded from the cell template's oj-action (see quoteTpl in
  // equipment-requests-page.html), NOT from table row selection — the template
  // stops propagation so hitting the icon opens the quote instead of navigating
  // to the request detail page.
  class ProjectQuoteChain extends ActionChain {
    async run(context, params) {
      const rowData = (params && params.rowData) || {};

      // requestNumericId is what the quote page actually keys on (the document
      // endpoint and both PATCHes take the numeric id), so it's required —
      // requestNumber alone can't load a quote.
      if (rowData.id == null) {
        console.warn('[ProjectQuoteChain] No request id in row data — cannot open quote.');
        return;
      }

      await Actions.navigateToPage(context, {
        page: 'project-quote',
        params: {
          requestId:        rowData.requestNumber || '',
          requestNumericId: rowData.id
        }
      });
    }
  }

  return ProjectQuoteChain;
});
