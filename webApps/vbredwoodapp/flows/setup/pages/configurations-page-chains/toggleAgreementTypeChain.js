define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // PATCH an agreement type's isActive flag from the in-row switch.
  // value is a boolean from oj-switch → mapped to 'Y'/'N'. Inactive types are
  // excluded from the agreement-create picker (activeOnly=true) but retained.
  class toggleAgreementTypeChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { id, value } = params || {};
      if (id == null) return;

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/patchConfAgreementType',
        uriParams: { id: Number(id) },
        body: { isActive: value === true ? 'Y' : 'N' }
      });

      if (result.ok) {
        await Actions.callChain(context, { chain: 'loadAgreementTypesChain' });
      } else {
        console.error('toggleAgreementTypeChain: failed for id', id, result.statusCode);
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not update type',
          message: 'Failed to change the active status. Please try again.',
          displayMode: 'transient',
          type: 'error'
        });
        // Reload to revert the optimistic switch position
        await Actions.callChain(context, { chain: 'loadAgreementTypesChain' });
      }
    }
  }

  return toggleAgreementTypeChain;
});
