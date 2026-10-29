define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class navigateToRequestDetailChain extends ActionChain {

    async run(context, params) {
      // oj-table fires firstSelectedRowChanged PART WAY THROUGH its own
      // select-and-focus sequence. Navigating synchronously from here tore the
      // page down mid-sequence, and the dying table then tried to resolve the
      // key of a row whose data was already gone:
      //   TypeError: Cannot read properties of undefined (reading 'key')
      //     at GetKey / _fireBeforeSelectEvent / HandleSelectionOption
      // reported by VB as "Fatal exception delivering binding updates", which
      // aborts the rest of that binding-delivery cycle. Yield one macrotask so
      // the table finishes selecting before the route changes. Navigation
      // behaviour is unchanged.
      await new Promise(resolve => setTimeout(resolve, 0));

      const requestNumber    = params && params.requestNumber;
      const requestNumericId = params && params.requestNumericId;
      if (!requestNumber) {
        return;
      }
      await Actions.navigateToPage(context, {
        page: 'customer-request-detail',
        params: {
          requestId:        requestNumber,
          requestNumericId: requestNumericId
        }
      });
    }
  }

  return navigateToRequestDetailChain;
});
