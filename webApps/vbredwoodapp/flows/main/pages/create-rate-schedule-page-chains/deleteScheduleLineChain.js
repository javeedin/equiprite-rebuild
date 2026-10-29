define([
  'vb/action/actionChain',
  'vb/action/actions'
], (ActionChain, Actions) => {
  'use strict';

  class deleteScheduleLineChain extends ActionChain {
    /**
     * Deletes the selected rows from the equipment lines and refreshes the data grid.
     *
     * @param {Object} context - The action chain context.
     */
    async run(context) {
      const { $page } = context;
  
      // Get the filtered array (with selected rows removed)
      const { updatedLines, deletedLines } = await $page.functions.deleteSelectedLines(
        $page.variables.equipmentLines,
        $page.variables.gridSelection
      );
      
      // Delete lines on the server if they have an ID
      for (const line of deletedLines) {
        if (line.id != null) {
          const deleteResp = await Actions.callRest(context, {
            endpoint: 'eqp-v1/deleteRatePeriodLine',
            uriParams: { id: line.id }
          });
          
          if (!deleteResp.ok) {
            await Actions.fireNotificationEvent(context, {
              summary: 'Delete Error',
              message: 'Failed to delete line from server: ' + deleteResp.status,
              displayMode: 'transient',
              type: 'error',
            });
          }
        }
      }
  
      // Update the variable
      $page.variables.equipmentLines = updatedLines;
  
      // Refresh the data grid provider
      $page.variables.dataGridProvider = await $page.functions.initGridData(updatedLines);
  
      // Clear the selection since the rows have been deleted
      $page.variables.gridSelection = [];
      
      // Fire success notification
      if (deletedLines.length > 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Lines Deleted',
          message: 'Successfully deleted ' + deletedLines.length + ' line(s).',
          displayMode: 'transient',
          type: 'confirmation',
        });
      }
    }
  }

  return deleteScheduleLineChain;
});
