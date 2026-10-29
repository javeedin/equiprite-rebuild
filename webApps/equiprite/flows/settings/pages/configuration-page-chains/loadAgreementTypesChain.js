define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/loadAgreementTypesChain.js, unchanged.

  // Load ALL agreement types (active + inactive) for the management table.
  // The GET endpoint returns a raw array of ConfAgreementTypeDto.
  class loadAgreementTypesChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getConfAgreementTypes'
      });

      if (result.ok) {
        $page.variables.AgreementTypeAllArray = Array.isArray(result.body) ? result.body : [];
      } else {
        console.error('loadAgreementTypesChain: failed', result.statusCode);
        $page.variables.saveError = 'Failed to load agreement types.';
      }
    }
  }

  return loadAgreementTypesChain;
});
