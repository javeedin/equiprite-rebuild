define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
], (ActionChain, Actions, cu) => {
  'use strict';

  // In-row Active switch. An inactive category is no longer offered when
  // adding attachments; documents already filed under it keep it.
  //
  // The backend REQUIRES objectVersionNumber on PATCH (400 without it, 409
  // when stale), unlike conf-agreement-types - so it is sent from the row.
  // Either way the table reloads, which also puts the switch back if the
  // PATCH failed.
  class toggleAttachmentCategoryChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { id, value } = params || {};
      if (id == null) return;
      const row = ($page.variables.AttCatAllArray || []).find(c => Number(c.id) === Number(id));
      if (!row) return;

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/patchAttachmentCategory',
        uriParams: { id: Number(id) },
        headers: cu.auditHeaders(context),
        body: { isActive: value === true ? 'Y' : 'N', objectVersionNumber: row.objectVersionNumber }
      });

      if (!result.ok) {
        const b = result.body || {};
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not update category',
          message: result.status === 409
            ? 'Someone else changed this category. The list has been refreshed - try again.'
            : (b.message || b.detail || ('HTTP ' + result.status)),
          displayMode: 'transient', type: 'error'
        });
      }
      await Actions.callChain(context, { chain: 'loadAttachmentCategoriesChain' });
    }
  }

  return toggleAttachmentCategoryChain;
});
