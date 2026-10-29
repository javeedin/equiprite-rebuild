define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class NavigateToDetailChain extends ActionChain {
    async run(context, params) {
      const rowData = params.rowData;

      if (!rowData || !rowData.requestNumber) {
        console.warn('[NavigateToDetailChain] Missing rowData or requestNumber, aborting.');
        return;
      }

      await Actions.navigateToPage(context, {
        page: 'customer-request-detail',
        params: {
          requestId:        rowData.requestNumber,
          requestNumericId: rowData.id
        }
      });
    }
  }

  return NavigateToDetailChain;
});
