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
  //   edit, submit → a project draft reopens in New request, a customer draft
  //                 in the customer portal's New request (edit on step 1,
  //                 submit on Review); Old EquipRite only for someone who
  //                 cannot open the customer portal.
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

        // Edit and Submit reopen the draft: a project draft in New request, a customer draft in the customer
        // portal's New request (both load and re-price it themselves). Someone who cannot open the customer portal
        // gets the customer draft in Old EquipRite, as before.
        const isCustomer = !!($page.variables.formData || {}).isCustomer;
        const params = { draftId: requestId, startStep: action === 'submit' ? 3 : 1 };
        if (!isCustomer) {
          await Actions.navigateToPage(context, { page: 'new-request', params });
          return;
        }
        const vars = $application.variables;
        if ($application.functions.navIdVisible(vars.pageAccessMap, vars.pageAccessLoaded, 'customer-portal')) {
          await Actions.navigateToFlow(context, { flow: 'customer', page: 'customer-new-request', params, target: 'parent' });
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
