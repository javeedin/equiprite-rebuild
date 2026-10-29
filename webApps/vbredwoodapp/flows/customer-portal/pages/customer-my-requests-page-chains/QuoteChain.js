define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class QuoteChain extends ActionChain {
    async run(context, params) {
      const rowData = params.rowData || {};

      if (!rowData.requestNumber && !rowData.id) {
        console.warn('[QuoteChain] No request data available.');
        return;
      }

      await Actions.navigateToPage(context, {
        page: 'customer-quote',
        params: {
          requestId:        rowData.requestNumber || '',
          requestNumericId: rowData.id            || null
        }
      });
    }
  }

  return QuoteChain;
});
