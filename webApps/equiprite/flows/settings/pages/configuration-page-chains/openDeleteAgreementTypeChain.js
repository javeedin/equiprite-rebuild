define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/openDeleteAgreementTypeChain.js. Unchanged except the
  // dialog: the confirmation is the page's confirm card (confirmChain runs the delete on OK).

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

      $page.variables.confirm = {
        kind: 'deleteAgreementType',
        section: 'agreement-types',
        title: 'Delete agreement type',
        okLabel: 'Delete',
        danger: true,
        message: 'Delete agreement type "' + $page.variables.DeleteAgreementTypeTarget.typeLabel + '"? Existing agreements already using it are unaffected.'
      };
    }
  }

  return openDeleteAgreementTypeChain;
});
