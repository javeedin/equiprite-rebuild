define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/draftResume'
], (ActionChain, Actions, draftResume) => {
  'use strict';

  // Draft actions on a request whose status is DRAFT (buttons shown only then). From Old EquipRite's
  // customer-portal/pages/customer-request-detail-page-chains/draftActionChain.js:
  //   askDelete / cancelDelete → open / close the confirmation dialog
  //   delete      → draftResume.deleteDraft, the same DELETE as the old page. The old page's formData carries no
  //                 requestor or portal-user id, so no callerUserId is sent; this page's formData does not either.
  //   edit, submit → the old page staged the draft for its create form and cart (draftResume.prepare); here New
  //                 request (customer) reopens it itself, with the same reads (draftResume.load and reprice), on step
  //                 1 to edit or on Review to submit. Submit and Save draft there update this request in place.
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
            await Actions.navigateToPage(context, { page: 'customer-requests' });
          }
          return;
        }

        await Actions.navigateToPage(context, {
          page: 'customer-new-request',
          params: { draftId: requestId, startStep: action === 'submit' ? 3 : 1 }
        });
      } finally {
        $page.variables.isDraftBusy = false;
      }
    }
  }

  return draftActionChain;
});
