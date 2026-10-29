define([
  'vb/action/actionChain',
  'resources/js/assetChildren',
], (ActionChain, assetChildren) => {
  'use strict';

  /**
   * "Cancel" on the child-assets warning: close it without staging. The unit
   * is asked about again if the user clicks Assign on it later.
   */
  class ChildAssetsCancelChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const check = $page.variables.childAssetCheck || {};

      const dlg = assetChildren.findDialog('childAssetsDialog');
      if (dlg && typeof dlg.close === 'function') dlg.close();

      $page.functions.completeStageAssign(check.resourceId, false);
      $page.variables.childAssetsAcknowledged = false;
    }
  }

  return ChildAssetsCancelChain;
});
