define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/openEditAgreementTypeChain.js. Unchanged except the
  // dialog: the old dialog is an inline editor in its section (shown while its is…Open flag is true).

  // Pencil (edit) affordance: pre-fill the edit dialog with the selected
  // agreement type's current Name + Prefix, then open the dialog.
  class openEditAgreementTypeChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { id } = params || {};
      if (id == null) return;

      const all = $page.variables.AgreementTypeAllArray || [];
      const row = all.find(function(t) { return Number(t.id) === Number(id); });
      if (!row) return;

      $page.variables.EditAgreementType = {
        id:         Number(row.id),
        typeLabel:  row.typeLabel  || '',
        typePrefix: row.typePrefix || ''
      };

      $page.variables.isAgrEditOpen = true;
    }
  }

  return openEditAgreementTypeChain;
});
