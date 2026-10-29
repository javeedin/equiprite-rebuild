define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Load ALL attachment categories (active + inactive) for the management
  // table. EQR_CONF_ATTACHMENT_CATEGORY via eqp-v1/listAttachmentCategories;
  // rows arrive in body.data (PagedResponse - NOT a bare array like
  // conf-agreement-types, verified 2026-10-01).
  //
  // These decide what the equipment Attachments dialogs offer: appliesTo
  // HEADER / LINE / BOTH (equipment master, serial unit, or both) and whether
  // Valid from / to are asked for (validityRequired).
  class loadAttachmentCategoriesChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/listAttachmentCategories',
        uriParams: { activeOnly: false }
      });

      if (result.ok) {
        const b = result.body || {};
        $page.variables.AttCatAllArray = Array.isArray(b.data) ? b.data : (Array.isArray(b) ? b : []);
      } else {
        console.error('loadAttachmentCategoriesChain: failed', result.status);
        $page.variables.saveError = 'Failed to load attachment categories.';
      }
    }
  }

  return loadAttachmentCategoriesChain;
});
