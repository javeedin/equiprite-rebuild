define([
  'vb/action/actionChain',
], function(ActionChain) {
  'use strict';

  // User clicked "No, keep in cart". Close the dialog and force a binding
  // re-evaluation so any checkboxes that were visually unchecked by the
  // user's click reaffirm their checked state from selectedEquipmentKeys.
  class RemoveFromCartCancelChain extends ActionChain {
    async run(context) {
      var $page = context.$page;

      var dialog = document.getElementById('removeFromCartDialog');
      if (dialog && typeof dialog.close === 'function') dialog.close();

      $page.variables.pendingUncheckEquipmentIds  = [];
      $page.variables.pendingUncheckDialogMessage = '';

      // Rebuild selectedById so the :checked bindings of the affected rows
      // re-evaluate and the user's visual uncheck reverts. Only the rows whose
      // keys are in the new map re-render -- no page-wide invalidation.
      $page.variables.selectedById =
        $page.functions.buildSelectedById($page.variables.selectedEquipmentKeys);
    }
  }

  return RemoveFromCartCancelChain;
});
