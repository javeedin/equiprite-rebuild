define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftResume'
], (ActionChain, Actions, draftResume) => {
  'use strict';

  // Customer-portal copy of main/equipment-request-detail-page-chains/
  // draftActionChain.js — keep the two in step. Draft actions on a request
  // whose status is DRAFT (buttons are shown only then). The work lives in
  // resources/js/draftResume.js; this chain only routes the buttons.
  //
  //   edit        → reopen in the create-request form (form + cart prefilled,
  //                 re-priced from today's catalog); Save as Draft / Submit there
  //                 update THIS request in place.
  //   submit      → same hand-off, but straight to the cart: one review click on
  //                 Submit runs every Submit rule (T&C, quote pricing, contract).
  //   askDelete / cancelDelete → open / close the confirmation dialog.
  //   delete      → DELETE the draft (lines and ship-to-site go with it).
  class draftActionChain extends ActionChain {
    async run(context, { action }) {
      const { $page } = context;
      const requestId = Number($page.variables.requestNumericId);

      if (action === 'askDelete' || action === 'cancelDelete') {
        await Actions.callComponentMethod(context, {
          selector: '#deleteDraftDialog',
          method:   action === 'askDelete' ? 'open' : 'close'
        });
        return;
      }
      if (!requestId || $page.variables.isDraftBusy) return;
      $page.variables.isDraftBusy = true;

      try {
        if (action === 'delete') {
          await Actions.callComponentMethod(context, { selector: '#deleteDraftDialog', method: 'close' });
          const fd = $page.variables.formData || {};
          const owner = fd.requestorUserId != null ? fd.requestorUserId : fd.eqrCustomerPortalUserId;
          const del = await draftResume.deleteDraft(context, Actions, requestId, owner);
          await Actions.fireNotificationEvent(context, del.ok
            ? { summary: 'Draft deleted', message: (fd.requestNumber || 'The draft') + ' was deleted.',
                type: 'confirmation', displayMode: 'transient' }
            : { summary: 'Delete failed', message: del.message, type: 'error', displayMode: 'persist' });
          if (del.ok) {
            await Actions.navigateToPage(context, { page: 'customer-my-requests' });
          }
          return;
        }

        const prep = await draftResume.prepare(context, Actions, requestId, 'customer');
        if (!prep.ok) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Could not open the draft', message: prep.message, type: 'error', displayMode: 'persist'
          });
          return;
        }
        if (prep.missing.length) {
          await Actions.fireNotificationEvent(context, {
            summary: 'Some equipment was left out',
            message: prep.missing.length + ' line(s) of ' + prep.requestNumber
              + ' are for equipment no longer in the catalog and were not added to the cart.',
            type: 'warning', displayMode: 'persist'
          });
        }
        // Same flow (customer-portal): the customer form, or straight to the cart.
        await Actions.navigateToPage(context, {
          page: action === 'submit' ? 'request-cart' : 'customer-create-req'
        });
      } finally {
        $page.variables.isDraftBusy = false;
      }
    }
  }

  return draftActionChain;
});
