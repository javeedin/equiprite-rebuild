define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Captures the Internal Customer typeahead pick. Mirrors
   * CaptureFallbackCustomerChain, then re-filters the Rental Agreement list
   * by the picked Fusion customer (TransferCustomerSelectedChain), same as
   * the real create-request page's CustomerSelectedChain.
   */
  class TransferCaptureFallbackCustomerChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page } = context;
      const id = data ? (data.CustomerId || data.PartyId || null) : null;

      $page.variables.transferInternalCustomerId  = id;
      $page.variables.transferSelectedInternalCustomerObj = data || null;

      await Actions.callChain(context, {
        chain: 'TransferCustomerSelectedChain',
        params: { fusionCustomerId: id }
      });
    }
  }

  return TransferCaptureFallbackCustomerChain;
});
