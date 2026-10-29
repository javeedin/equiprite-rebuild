define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class loadCustomerRefsChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getCustomerRefs'
      });

      console.log('[load-customers] result:', JSON.stringify({ ok: result && result.ok, status: result && result.status, len: result && result.body && result.body.data && result.body.data.length }));

      if (!result || !result.body || !result.body.data) {
        console.warn('[load-customers] no data returned');
        return;
      }

      $page.variables.customerRefsArray = result.body.data
        .filter(c => c != null)
        .map(c => ({
          id:           c.id,
          customerName: c.customerName || String(c.id)
        }));
    }
  }

  return loadCustomerRefsChain;
});
