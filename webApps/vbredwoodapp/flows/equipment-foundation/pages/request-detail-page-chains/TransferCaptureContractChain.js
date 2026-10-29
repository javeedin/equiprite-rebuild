define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Captures the Contract picked in the Transfer drawer. Mirrors
   * CaptureContractChain — clears the (contract-scoped) delivery location
   * and reloads Ship-To-Sites for the new contract.
   */
  class TransferCaptureContractChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page } = context;

      $page.variables.transferContractId          = data ? data.CONTRACT_ID : null;
      $page.variables.transferSelectedContractObj = data || null;

      $page.variables.transferLocation              = '';
      $page.variables.transferSelectedShipToSiteObj = null;
      $page.variables.transferShipToSitesADP.data   = [];
      $page.variables.transferShipToSitesLoaded     = false;

      await Actions.callChain(context, { chain: 'TransferLoadShipToSitesChain' });
    }
  }

  return TransferCaptureContractChain;
});
