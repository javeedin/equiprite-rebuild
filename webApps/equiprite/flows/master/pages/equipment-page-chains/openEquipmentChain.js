define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A row opens Equipment detail (the old RowClickChain opened equipment-units). The old chain also read the
  // master by id here only to pass its control type along; the detail page reads that same record first thing
  // and takes the control type from it with the same rule, so that call is made there, once.
  class openEquipmentChain extends ActionChain {
    async run(context, { row }) {
      // oj-table fires firstSelectedRowChanged part way through its own select-and-focus sequence; navigating
      // synchronously tears the table down mid-sequence (old RowClickChain). Yield one macrotask first.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!row || !row.id) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Details Unavailable',
          message: 'Could not resolve the equipment master ID for this row.',
          type: 'warning',
          displayMode: 'transient',
        });
        return;
      }
      await Actions.navigateToPage(context, { page: 'equipment-detail', params: { equipmentId: String(row.id) } });
    }
  }

  return openEquipmentChain;
});
