define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // "Complete Details" in the Complete Request Details popup: back to the
  // create form so a soft reservation can fill what Submit needs. Uses the
  // catalog back button's same-trip return (isReturningToCreate), so
  // HydrateDraftChain keeps the form AND the cart; it also shows the
  // completeForSubmitFields list as a notice. Next → catalog → cart → Submit.
  class CompleteDetailsChain extends ActionChain {
    async run(context) {
      const { $page, $flow } = context;

      $flow.variables.completeForSubmitFields = ($page.variables.missingForSubmit || []).slice();
      $flow.variables.isReturningToCreate = true;

      const dlg = document.getElementById('completeDetailsDialog');
      if (dlg && typeof dlg.close === 'function') dlg.close();

      // Soft reservation is project-create-request only (hidden on the
      // customer page), so that is always the form to return to.
      await Actions.navigateToPage(context, { page: 'project-create-request' });
    }
  }

  return CompleteDetailsChain;
});
