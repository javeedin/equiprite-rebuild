define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (ActionChain, Actions) => {
  'use strict';

  class RowClickChain extends ActionChain {
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

      const rowData = params.rowData;
      if (!rowData || !rowData.request_number) {
        console.warn('[RowClickChain] No row data or request_number found');
        return;
      }

      await Actions.navigateToPage(context, {
        page: 'request-detail',
        params: {
          requestNumber: rowData.request_number,
          requestId:     String(rowData.request_id),
          sourcePage:    'Equipment Workbench'
        }
      });
    }
  }

  return RowClickChain;
});
