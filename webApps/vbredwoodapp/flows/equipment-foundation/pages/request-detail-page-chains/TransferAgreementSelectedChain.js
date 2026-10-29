define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /**
   * Captures the Rental Agreement picked in the Transfer drawer.
   *
   * SIMPLIFIED relative to the real create-request page's
   * AgreementSelectedChain: that version also fetches the agreement's lines
   * and primes the catalog with agreement-priced equipment, because picking
   * an agreement there immediately routes into the catalog/cart flow. The
   * Transfer drawer has no catalog step — the destination line is already
   * fixed to the SAME equipment as the source line — so only the display
   * fields are captured here. Extend this if the destination line should
   * ever be repriced off the picked agreement.
   */
  class TransferAgreementSelectedChain extends ActionChain {
    async run(context, { agreementId } = {}) {
      const { $page } = context;
      const id = agreementId != null ? Number(agreementId) : null;
      $page.variables.transferAgreementId = id;
    }
  }

  return TransferAgreementSelectedChain;
});
