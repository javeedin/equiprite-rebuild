define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/openEditAttachmentCategoryChain.js. Unchanged except the
  // dialog: the old dialog is an inline editor in its section (shown while its is…Open flag is true).

  // Edit (pencil): pre-fill the edit dialog from the row, then open it.
  // The dialog sits at the page's top level (see attachmentCategoryEditDialog).
  class openEditAttachmentCategoryChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { id } = params || {};
      if (id == null) return;
      const row = ($page.variables.AttCatAllArray || []).find(c => Number(c.id) === Number(id));
      if (!row) return;

      $page.variables.EditAttCat = {
        id: Number(row.id),
        categoryCode: row.categoryCode || '',
        categoryLabel: row.categoryLabel || '',
        appliesTo: row.appliesTo || 'BOTH',
        validityRequired: row.validityRequired === 'Y' ? 'Y' : 'N',
        defaultValidityMonths: row.defaultValidityMonths == null ? null : Number(row.defaultValidityMonths),
        objectVersionNumber: row.objectVersionNumber
      };

      $page.variables.isAttEditOpen = true;
    }
  }

  return openEditAttachmentCategoryChain;
});
