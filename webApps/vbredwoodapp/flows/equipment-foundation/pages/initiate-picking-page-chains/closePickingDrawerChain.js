define([
  'vb/action/actionChain',
  'ojs/ojkeyset',
], (ActionChain, keySet) => {
  'use strict';

  class closePickingDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const dialog = document.getElementById('pickingDetailDialog');
      if (dialog && typeof dialog.close === 'function') dialog.close();

      $page.variables.isDrawerOpen = false;
      $page.variables.selectedRequest = { lines: [], pickingExceptions: [] };

      // Release the pick slip blob. This is the right place for it: the slip is
      // generated per request when the drawer opens and rendered by BOTH the
      // thumbnail card and the preview, so it stays alive as long as the drawer
      // is showing that request. An un-revoked object URL holds its PDF in
      // memory for the life of the tab, and a warehouse user working through a
      // queue opens a lot of requests.
      if ($page.variables.pickSlipUrl) {
        try {
          URL.revokeObjectURL($page.variables.pickSlipUrl);
        } catch (e) {
          console.warn('[closePickingDrawer] pick slip revoke failed:', e);
        }
      }
      $page.variables.pickSlipUrl       = '';
      $page.variables.pickSlipFileName  = '';
      $page.variables.pickSlipDocNumber = '';

      // Clear the table's selected row so re-clicking the SAME row counts
      // as a selection change and re-fires onRowAction — without this the
      // dialog won't reopen on a second click of the same request. Deferred
      // to the next tick so it runs after the dialog hands focus back to the
      // table; uses KeySetImpl (the JET cookbook's canonical reset).
      setTimeout(() => {
        try {
          const table = document.getElementById('initiatePickingTable');
          if (table) {
            table.selected = { row: new keySet.KeySetImpl(), column: new keySet.KeySetImpl() };
          }
        } catch (e) {
          console.warn('[closePickingDrawer] could not clear table selection:', e);
        }
      }, 0);
    }
  }

  return closePickingDrawerChain;
});
