define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

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

      const dlg = document.getElementById('agreementTypeEditDialog');
      if (dlg) dlg.open();
    }
  }

  return openEditAgreementTypeChain;
});
