define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Serial click on the units grid -> the unit-detail page (stock record plus
  // its maintenance-asset and fixed-asset tabs).
  //
  // Replaces the max-size stub dialog this page used to open, which only ever
  // echoed the selected id back.
  //
  // rowId arrives from the table's own ojRowAction event (event.detail.context),
  // which fires on the FIRST click and on Enter.
  //
  // This used to hang off an oj-button in the serial cell. oj-table consumes
  // the first click to move focus into the cell, so the button only ever saw
  // the second one and opening a unit took two clicks. Letting the table raise
  // the drill-down instead fixes that, and makes the whole row the target.
  class goToUnitDetailChain extends ActionChain {
    async run(context, { rowId }) {
      const { $page } = context;

      if (!rowId) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Details Unavailable',
          message: 'Could not resolve the unit for this row.',
          type: 'warning',
          displayMode: 'transient'
        });
        return;
      }

      // Yield one macrotask before routing. Navigating synchronously from
      // inside the table's own event dispatch tears the page down mid-sequence
      // and the dying table then fails to resolve the row key
      // ("Fatal exception delivering binding updates").
      await new Promise(resolve => setTimeout(resolve, 0));

      await Actions.navigateToPage(context, {
        page: 'equipment-unit-detail',
        params: {
          equipmentId: String($page.variables.equipmentId || ''),
          serialRefId: String(rowId),
          controlType: $page.variables.controlType || 'SERIAL'
        }
      });
    }
  }

  return goToUnitDetailChain;
});
