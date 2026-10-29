define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens a request from the returns queue in the workspace below it. The old page opened a modal from the
  // table row (onRowAction -> openPickingDrawerChain); this hands the same queue row to the same chain, copied
  // unchanged, so the same calls load its lines. `next` opens the row after the open one in the filtered queue.
  // Not while a receipt is being saved: AcceptReturnLinesChain refreshes the request it was started on.
  class openRequestChain extends ActionChain {
    async run(context, { id, next }) {
      const { $page } = context;
      const v = $page.variables;
      if (v.isAccepting) {
        return;
      }
      const all = v.PickingQueueAllArray || [];
      let row = null;
      if (next) {
        const shown = $page.functions.queueRows(all, v.queueText, v.queueClass);
        row = $page.functions.nextRequest(shown, v.selectedRequest && v.selectedRequest.id);
      } else {
        row = all.find((r) => String(r.id) === String(id)) || null;
      }
      if (!row) {
        return;
      }
      v.lineSelectionState = { count: 0 };
      v.actualReturnDate = '';

      const loading = Actions.callChain(context, { chain: 'openPickingDrawerChain', params: { rowData: row } });
      setTimeout(() => {
        const el = typeof document !== 'undefined' && document.getElementById('rcWorkspace');
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 80);
      await loading;
    }
  }

  return openRequestChain;
});
