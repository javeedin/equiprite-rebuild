define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
], (ActionChain, Actions, cu) => {
  'use strict';

  // Delete the category chosen with a row's trash icon, after its confirm
  // dialog (target in DeleteAttCatTarget, set by openDeleteAttachmentCategoryChain).
  //
  // The backend refuses (409) when any attachment uses the category - those
  // documents must keep it. In that case the message says to switch it off
  // with the Active toggle instead, which hides it from new uploads only.
  class deleteAttachmentCategoryChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const t = $page.variables.DeleteAttCatTarget || {};
      if (!t.id) return;

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/deleteAttachmentCategory',
        uriParams: { id: Number(t.id) },
        headers: cu.auditHeaders(context)
      });

      const dlg = document.getElementById('attachmentCategoryDeleteDialog');
      if (dlg) dlg.close();

      if (result.ok) {
        await Actions.callChain(context, { chain: 'loadAttachmentCategoriesChain' });
        await Actions.fireNotificationEvent(context, {
          summary: 'Category deleted', message: '"' + t.categoryLabel + '" was deleted.',
          displayMode: 'transient', type: 'confirmation'
        });
      } else {
        const b = result.body || {};
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not delete category',
          message: result.status === 409
            ? 'Documents are filed under "' + t.categoryLabel + '", so it can not be deleted. Switch it off with Active instead - it will no longer be offered for new attachments.'
            : (b.message || b.detail || ('HTTP ' + result.status)),
          displayMode: 'persist', type: 'error'
        });
      }
    }
  }

  return deleteAttachmentCategoryChain;
});
