define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftStorage',
  'resources/js/requestModel',
], (ActionChain, Actions, draftStorage, requestModel) => {
  'use strict';

  // Confirmed clear: invoked by the "Clear agreement" button inside the
  // clearAgreementDialog. Discards all agreement-driven state and resets
  // the page to a fresh standalone request — same effect as opening
  // project-create-request directly from the dashboard.
  class ClearAgreementContextChain extends ActionChain {
    async run(context) {
      const { $flow, $page } = context;

      // Wipe the per-tab "agreement session" signal so HydrateDraftChain
      // (on refresh) doesn't try to re-hydrate the agreement state.
      try { sessionStorage.removeItem('eqr.agreement.active'); } catch (e) { /* silent */ }

      // Drop the persisted draft entirely — same effect as case (c) wipe.
      draftStorage.clear();

      // Reset the Path-B agreement dropdown selection too, so the field
      // shows "— No agreement —" after clearing from the banner.
      if ($page && $page.variables) $page.variables.selectedAgreementId = null;

      // Reset all flow vars to their fresh-entry defaults.
      $flow.variables.fromAgreementId               = null;
      $flow.variables.fromAgreementNumber           = '';
      $flow.variables.fromAgreementCustomer         = '';
      $flow.variables.fromAgreementEffectiveFrom    = '';
      $flow.variables.fromAgreementEffectiveTo      = '';
      $flow.variables.agreementLineIdByEquipmentId  = {};
      $flow.variables.agreementClassIds             = [];
      $flow.variables.CartItemsArray                = [];
      $flow.variables.ActiveRequestDetail           = {};
      $flow.variables.requestOrigin                 = '';
      $flow.variables.request = requestModel.defaultRequest();

      // Close the confirmation dialog now that the clear is complete.
      const dialog = document.getElementById('clearAgreementDialog');
      if (dialog && typeof dialog.close === 'function') dialog.close();

      await Actions.fireNotificationEvent(context, {
        summary: 'Agreement cleared',
        message: 'Form reset. You can now build a request from scratch.',
        displayMode: 'transient',
        type: 'info'
      });
    }
  }

  return ClearAgreementContextChain;
});
