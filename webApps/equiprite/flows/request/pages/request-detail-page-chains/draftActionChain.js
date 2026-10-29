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
  //   edit, submit → open this request in Old EquipRite, whose Edit / Submit
  //                 reopen the draft in its cart (New EquipRite has no cart yet).
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

        // Edit and Submit reopen the draft in the cart. New EquipRite's cart is not built yet, so they open this
        // request in Old EquipRite, where its Edit / Submit buttons work as before.
        const link = $page.functions.oldDetailLink($application.variables.oldAppUrl, $page.variables.requestId, requestId,
          !!($page.variables.formData || {}).isCustomer);
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
