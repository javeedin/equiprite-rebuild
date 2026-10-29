define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/openDeleteAttachmentCategoryChain.js. Unchanged except the
  // dialog: the confirmation is the page's confirm card (confirmChain runs the delete on OK).

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

      $page.variables.confirm = {
        kind: 'deleteAttCat',
        section: 'attachments',
        title: 'Delete attachment category',
        okLabel: 'Delete',
        danger: true,
        message: 'Delete the category "' + $page.variables.DeleteAttCatTarget.categoryLabel + '"? A category that already has documents '
          + 'filed under it can not be deleted. Switch it off with Active instead, so it is no longer offered for new attachments.'
      };
    }
  }

  return openDeleteAttachmentCategoryChain;
});
