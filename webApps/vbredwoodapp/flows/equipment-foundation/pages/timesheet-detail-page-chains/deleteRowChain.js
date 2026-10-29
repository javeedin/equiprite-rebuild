define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Delete a crew/equipment timesheet row.
   *
   * Same fix as duplicateRowChain: the chain was declared in
   * timesheet-detail-page.json with no matching .js file in this folder, so VBCS
   * could not build it and the Delete menu item did nothing.
   *
   * deleteRow() refuses parent rows (the first row for a request line, generated
   * from the deployed line), so a false return is expected there, not an error.
   */
  class deleteRowChain extends ActionChain {

    /**
     * @param {Object} context
     * @param {Object} params
     * @param {number} params.rowIndex
     */
    async run(context, { rowIndex }) {
      const { $page, $functions } = context;

      const ok = $functions.deleteRow(rowIndex);
      if (!ok) {
        console.warn('[deleteRowChain] deleteRow rejected rowIndex:', rowIndex);
        return;
      }

      $page.variables.isDirty = true;
      $page.variables.undoDisabled = false;
    }
  }

  return deleteRowChain;
});
