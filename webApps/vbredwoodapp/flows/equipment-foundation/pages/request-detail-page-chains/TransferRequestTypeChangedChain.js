define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Fires when the Transfer drawer's Customer Type toggles between INTERNAL
   * and EXTERNAL. Mirrors RequestTypeChangedChain on project-create-request-page:
   * switching TO external loads the customer/contact LOVs (only once — see
   * TransferLoadExternalPartyLovsChain's own guard).
   */
  class TransferRequestTypeChangedChain extends ActionChain {
    async run(context, { requestType } = {}) {
      const { $page } = context;
      const rt = (requestType || 'INTERNAL').toUpperCase();
      $page.variables.transferCustomerType = rt;

      if (rt === 'EXTERNAL') {
        await Actions.callChain(context, { chain: 'TransferLoadExternalPartyLovsChain' });
      }
    }
  }

  return TransferRequestTypeChangedChain;
});
