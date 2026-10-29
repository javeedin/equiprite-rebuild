define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Import from Fusion opens its own page (the old page's near-full-screen dialog). It writes the equipment
  // master, so FULL access only: the button is hidden below FULL and this is the backstop (old
  // SecondaryActionChain, importFusion).
  class openImportChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      const vars = $application.variables;
      if ($application.functions.pageAccess(vars.pageAccessMap, vars.pageAccessLoaded, 'EQR_EQUIPMENT_MASTER') !== 'FULL') {
        return;
      }
      await Actions.navigateToPage(context, { page: 'equipment-import' });
    }
  }

  return openImportChain;
});
