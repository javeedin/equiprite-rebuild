define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/loadAuditTrailChain.js, unchanged.

  class loadAuditTrailChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getAuditTrail'
      });

      if (result.ok) {
        $page.variables.AuditTrailAllArray = result.body.data || [];
      } else {
        console.error('loadAuditTrailChain: Failed', result.statusCode);
      }
    }
  }

  return loadAuditTrailChain;
});
