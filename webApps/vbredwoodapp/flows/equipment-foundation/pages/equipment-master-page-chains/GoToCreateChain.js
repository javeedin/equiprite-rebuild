define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Create needs FULL access to EQR_EQUIPMENT_MASTER. The button is hidden
   * below FULL; this check covers a click that lands before the binding
   * re-renders. The Create page has its own guard for direct URLs.
   */
  class GoToCreateChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      const vars = $application.variables;
      if ($application.functions.pageAccess(vars.pageAccessMap, vars.pageAccessLoaded,
            'EQR_EQUIPMENT_MASTER') !== 'FULL') {
        return;
      }
      await Actions.navigateToPage(context, {
        page: 'equipment-create'
      });
    }
  }

  return GoToCreateChain;
});
