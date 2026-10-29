define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class BulkInitiatePickingChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const selectedIds = [...$page.variables.selectedIds];
      if (!selectedIds.length) return;

      $page.variables.isBulkInitiating       = true;
      $page.variables.bulkProgressDialogOpen = true;
      $page.variables.bulkProgressCurrent    = 0;
      $page.variables.bulkProgressTotal      = selectedIds.length;
      $page.variables.showBulkSummary        = false;
      $page.variables.bulkSummaryCompleted   = 0;
      $page.variables.bulkSummaryExceptions  = 0;

      let completed  = 0;
      let exceptions = 0;
      const results  = Object.assign({}, $page.variables.lastPickingResults);

      for (let i = 0; i < selectedIds.length; i++) {
        const requestId = selectedIds[i];
        $page.variables.bulkProgressCurrentRequest = requestId;

        // Yield to render queue so progress bar updates each iteration
        await new Promise(r => setTimeout(r, 0));

        // Simulate API call
        await new Promise(r => setTimeout(r, 600));

        // All succeed in demo
        results[requestId] = { status: 'COMPLETED', message: 'Bulk picking initiated.' };
        completed++;

        $page.variables.bulkProgressCurrent = i + 1;

        // Update AllArray for this record
        $page.variables.PickingQueueAllArray = $page.variables.PickingQueueAllArray.map(r => {
          if (r.id !== requestId) return r;
          return { ...r, status: 'PICK_INITIATED', pickingExceptions: [] };
        });
      }

      $page.variables.lastPickingResults     = results;
      $page.variables.isBulkInitiating       = false;
      $page.variables.bulkProgressCurrentRequest = '';
      $page.variables.selectedIds            = [];
      $page.variables.bulkSummaryCompleted   = completed;
      $page.variables.bulkSummaryExceptions  = exceptions;
      $page.variables.showBulkSummary        = true;

      this._rebuildFilteredArray($page);
    }

    _rebuildFilteredArray($page) {
      $page.variables.PickingQueueFilteredArray = [...$page.variables.PickingQueueAllArray];
    }
  }

  return BulkInitiatePickingChain;
});
