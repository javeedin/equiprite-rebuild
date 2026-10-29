define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (
  ActionChain,
  Actions,
  ActionUtils
) => {
  'use strict';

  class ButtonActionChain extends ActionChain {

    /**
     * @param {Object} context
     * @param {Object} params
     * @param {object} params.event
     * @param {any} params.originalEvent
     */
    async run(context, { event, originalEvent }) {
      const { $page, $flow, $application, $constants, $variables, $functions } = context;

      // Export the LIVE rows shown in the active tab (page-module functions
      // can't read $page.variables, so pass the arrays in). Utilization passes
      // its flat per-(yard,day) rows via _utilExportRows (set in loadActiveTab).
      await $functions.exportCSV($variables.analyticsActiveTab, {
        stock:   $variables.stockRows,
        pending: $variables.pendingRows,
        onhand:  $variables.onhandRows,
        util:    $variables.utilExportRows
      });
    }
  }

  return ButtonActionChain;
});
