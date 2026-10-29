define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Whole-row click on the billed-requests list → open the billing detail
  // (request header + per-line invoice schedules). Passes the same identifiers
  // the request-detail page uses: requestId (=requestNumber) and the numeric id.
  class NavigateToBillingDetailChain extends ActionChain {
    async run(context, params) {
      const rowData = params.rowData;

      if (!rowData || !rowData.requestNumber) {
        console.warn('[NavigateToBillingDetailChain] Missing rowData or requestNumber, aborting.');
        return;
      }

      await Actions.navigateToPage(context, {
        page: 'customer-billing-detail',
        params: {
          requestId:        rowData.requestNumber,
          requestNumericId: rowData.id
        }
      });
    }
  }

  return NavigateToBillingDetailChain;
});
