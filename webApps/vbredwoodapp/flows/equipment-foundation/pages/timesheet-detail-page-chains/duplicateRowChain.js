define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Duplicate a crew/equipment timesheet row.
   *
   * This page uses JavaScript action chains (this -chains/ folder). The chain was
   * declared in timesheet-detail-page.json but had no .js file, so VBCS failed with
   * "Failed to create code chain" and the Duplicate menu item did nothing.
   *
   * Mirrors the JSON definition: call $functions.duplicateRow(rowIndex), then mark
   * the page dirty and enable Undo.
   */
  class duplicateRowChain extends ActionChain {

    /**
     * @param {Object} context
     * @param {Object} params
     * @param {number} params.rowIndex
     */
    async run(context, { rowIndex }) {
      const { $page, $functions } = context;

      const ok = $functions.duplicateRow(rowIndex);
      if (!ok) {
        console.warn('[duplicateRowChain] duplicateRow rejected rowIndex:', rowIndex);
        return;
      }

      $page.variables.isDirty = true;
      $page.variables.undoDisabled = false;
    }
  }

  return duplicateRowChain;
});
