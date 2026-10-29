define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Trash icon on an attachment-category row: remember which category, then
  // open the confirm dialog. The delete itself runs from
  // deleteAttachmentCategoryChain on confirm (same split as Agreement Types).
  class openDeleteAttachmentCategoryChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { id } = params || {};
      if (id == null) return;

      const row = ($page.variables.AttCatAllArray || []).find(c => Number(c.id) === Number(id));
      if (!row) return;

      $page.variables.DeleteAttCatTarget = {
        id: Number(row.id),
        categoryLabel: row.categoryLabel || ''
      };

      const dlg = document.getElementById('attachmentCategoryDeleteDialog');
      if (dlg) dlg.open();
    }
  }

  return openDeleteAttachmentCategoryChain;
});
