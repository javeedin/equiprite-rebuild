define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Re-runs the drawer load for the request that is already open, WITHOUT
  // closing the dialog. Delegates to openPickingDrawerChain so there is only
  // one place that knows how to fetch transfer orders + lines + allocations.
  //
  // Used when:
  //   - a TO is still being created in Fusion and has no order number yet
  //     (the Release button stays blocked until it appears), or
  //   - lines were left at PICK_INITIATED and their live state needs re-reading
  //     after a Ship Confirm recovery.
  class RefreshPickingDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const current = $page.variables.selectedRequest;
      if (!current || !(current.eqrEquipmentRequestId || current.id)) return;

      $page.variables.isRefreshingDrawer = true;
      try {
        // openPickingDrawerChain re-opens the same dialog (already open, so
        // this is a no-op visually) and repopulates TOs, lines and statuses.
        await Actions.callChain(context, {
          chain: 'openPickingDrawerChain',
          params: { rowData: current }
        });
      } catch (e) {
        console.warn('[RefreshPickingDrawerChain] refresh failed:', e);
      } finally {
        $page.variables.isRefreshingDrawer = false;
      }
    }
  }

  return RefreshPickingDrawerChain;
});
