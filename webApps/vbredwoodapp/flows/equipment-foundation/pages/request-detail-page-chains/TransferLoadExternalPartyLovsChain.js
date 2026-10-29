define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Loads the External Customer + Customer Contact LOVs for the Transfer
   * drawer. Exact mirror of LoadExternalPartyLovsChain (same endpoints, same
   * row shape) — see that file for the full rationale.
   */
  class TransferLoadExternalPartyLovsChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      if (($page.variables.transferCustomersArray || []).length &&
          ($page.variables.transferCustomerPortalUsersArray || []).length) {
        return;
      }

      const [custResp, usersResp] = await Promise.all([
        Actions.callRest(context, { endpoint: 'eqp-v1/getCustomerRefs' }),
        Actions.callRest(context, { endpoint: 'eqp-v1/getCustomerPortalUsers' })
      ]);

      $page.variables.transferCustomersArray =
        (custResp && custResp.ok && custResp.body && Array.isArray(custResp.body.data))
          ? custResp.body.data
              .filter(c => c != null && c.id != null)
              .map(c => ({ id: Number(c.id), customerName: c.customerName || ('Customer ' + c.id) }))
          : [];

      $page.variables.transferCustomerPortalUsersArray =
        (usersResp && usersResp.ok && usersResp.body && Array.isArray(usersResp.body.data))
          ? usersResp.body.data
              .filter(u => u != null && u.id != null)
              .map(u => ({
                id:          Number(u.id),
                contactName: u.contactName || u.username || ('User ' + u.id),
                username:    u.username || '',
                email:       u.email || ''
              }))
          : [];

      console.log('[TransferLoadExternalPartyLovsChain] customers:', $page.variables.transferCustomersArray.length,
                  'contacts:', $page.variables.transferCustomerPortalUsersArray.length);
    }
  }

  return TransferLoadExternalPartyLovsChain;
});
