define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftResume'
], (ActionChain, Actions, draftResume) => {
  'use strict';

  // Draft actions on a request whose status is DRAFT (buttons are shown only
  // then). The work lives in resources/js/draftResume.js; this chain only
  // routes the buttons.
  //
  //   edit, submit → a project draft reopens in New request (edit on step 1,
  //                 submit on Review); a customer draft opens in Old EquipRite,
  //                 whose Edit / Submit reopen it in its cart.
  //   askDelete / cancelDelete → open / close the confirmation dialog.
  //   delete      → DELETE the draft (lines and ship-to-site go with it).
  class draftActionChain extends ActionChain {
    async run(context, { action }) {
      const { $page, $application } = context;
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
            await Actions.navigateToPage(context, { page: 'my-requests' });
          }
          return;
        }

        // Edit and Submit reopen the draft. New request takes project drafts (it loads and re-prices them itself);
        // customer requests are not raised in New EquipRite yet, so those open in Old EquipRite as before.
        const isCustomer = !!($page.variables.formData || {}).isCustomer;
        if (!isCustomer) {
          await Actions.navigateToPage(context, {
            page: 'new-request',
            params: { draftId: requestId, startStep: action === 'submit' ? 3 : 1 },
          });
          return;
        }
        const link = $page.functions.oldDetailLink($application.variables.oldAppUrl, $page.variables.requestId, requestId, true);
        if (link) {
          window.location.assign(link);
        }
      } finally {
        $page.variables.isDraftBusy = false;
      }
    }
  }

  return draftActionChain;
});
