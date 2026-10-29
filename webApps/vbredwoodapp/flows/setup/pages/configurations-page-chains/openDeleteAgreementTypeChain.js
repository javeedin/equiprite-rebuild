define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Trash affordance on an Agreement Type row: stash the row as the delete
  // target (id + label for the confirm message) and open the confirm dialog.
  // The actual delete runs from deleteAgreementTypeChain on confirm.
  class openDeleteAgreementTypeChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { id } = params || {};
      if (id == null) return;

      const row = ($page.variables.AgreementTypeAllArray || [])
        .find(t => Number(t.id) === Number(id));
      if (!row) return;

      $page.variables.DeleteAgreementTypeTarget = {
        id:        Number(row.id),
        typeLabel: row.typeLabel || ''
      };

      const dlg = document.getElementById('agreementTypeDeleteDialog');
      if (dlg) dlg.open();
    }
  }

  return openDeleteAgreementTypeChain;
});
