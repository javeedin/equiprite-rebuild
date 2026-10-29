define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class CardClickChain extends ActionChain {
    async run(context, { requestNumber, projectName, weekStartDate }) {
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

      if (!requestNumber) {
        console.warn('[CardClickChain] No requestNumber — cannot navigate');
        return;
      }
      await Actions.navigateToPage(context, {
        page: 'timesheet-detail',
        params: {
          requestId:    requestNumber,
          projectName:  projectName  || '',
          weekStartDate: weekStartDate || ''
        }
      });
    }
  }

  return CardClickChain;
});
