define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Hard-delete an agreement type, then reload the table.
  // NOTE: this removes the type definition only — existing agreements that
  // already store the code keep it (AGREEMENT_TYPE is a free string, no FK).
  // To retire a type without deleting, toggle it inactive instead.
  class deleteAgreementTypeChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { id } = params || {};
      if (id == null) return;

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/deleteConfAgreementType',
        uriParams: { id: Number(id) }
      });

      const dlg = document.getElementById('agreementTypeDeleteDialog');
      if (dlg) dlg.close();

      if (result.ok) {
        await Actions.callChain(context, { chain: 'loadAgreementTypesChain' });
      } else {
        console.error('deleteAgreementTypeChain: failed for id', id, result.statusCode);
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not delete type',
          message: 'Failed to delete the agreement type. Please try again.',
          displayMode: 'transient',
          type: 'error'
        });
      }
    }
  }

  return deleteAgreementTypeChain;
});
