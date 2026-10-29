define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens a request from the queue in the picking workspace below it. The old page opened a modal dialog
  // from the table row (onRowAction -> openPickingDrawerChain); this hands the same queue row to the same
  // chain, copied unchanged, so the same calls load it. `next` opens the row after the open one in the
  // filtered queue ("Next request").
  //
  // Not while a release, a ship or a refresh is running: those chains write the result back into the open
  // request, so switching under them would show it against another one (the old modal blocked this).
  class openRequestChain extends ActionChain {
    async run(context, { id, next }) {
      const { $page } = context;
      const v = $page.variables;
      if (v.isReleasingTO || v.isShipConfirming || v.isRefreshingDrawer) {
        return;
      }
      const all = v.PickingQueueAllArray || [];
      let row = null;
      if (next) {
        const shown = $page.functions.queueRows(all, v.queueText, v.queueChip);
        row = $page.functions.nextRequest(shown, v.selectedRequest && v.selectedRequest.id);
      } else {
        row = all.find((r) => String(r.id) === String(id)) || null;
      }
      if (!row) {
        return;
      }

      const loading = Actions.callChain(context, { chain: 'openPickingDrawerChain', params: { rowData: row } });
      setTimeout(() => {
        const el = typeof document !== 'undefined' && document.getElementById('pickWorkspace');
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 80);
      await loading;
    }
  }

  return openRequestChain;
});
