define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/assetChildren',
], (ActionChain, Actions, assetChildren) => {
  'use strict';

  /**
   * "Assign this unit only" on the asset-hierarchy warning: the user has ticked
   * the acknowledgement, so stage the unit. Session-only — nothing is saved
   * about the acknowledgement itself.
   */
  class ChildAssetsProceedChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const check = $page.variables.childAssetCheck || {};
      if (!$page.variables.childAssetsAcknowledged) return;

      const dlg = assetChildren.findDialog('childAssetsDialog');
      if (dlg && typeof dlg.close === 'function') dlg.close();

      const outcome = $page.functions.completeStageAssign(check.resourceId, true,
        check.descendantCount || 0);
      await assetChildren.notifyOutcome(context, Actions, outcome, check.serialNumber);
    }
  }

  return ChildAssetsProceedChain;
});
