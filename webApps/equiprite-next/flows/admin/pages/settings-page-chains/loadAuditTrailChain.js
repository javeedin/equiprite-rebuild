define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // New EquipRite's loadAuditTrailChain (from Old's), unchanged: GET audit-trail.
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
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return loadAuditTrailChain;
});
