define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /**
   * Re-filters the Rental Agreement list by the Internal Customer just
   * picked — mirrors CustomerSelectedChain on project-create-request-page.
   * transferAgreementOptionsArray rows carry fusionCustomerId (set by
   * TransferLoadAgreementsChain); an unset/no-match customer falls back to
   * the FULL unfiltered list rather than an empty one, since a blank
   * dropdown reads as "no agreements exist" rather than "nothing picked yet".
   */
  class TransferCustomerSelectedChain extends ActionChain {
    async run(context, { fusionCustomerId } = {}) {
      const { $page } = context;
      const id = fusionCustomerId != null ? Number(fusionCustomerId) : null;
      $page.variables.transferFusionCustomerId = id;

      const all = $page.variables.transferAgreementOptionsArray || [];
      if (id == null) {
        $page.variables.transferFilteredAgreementsArray = all;
        return;
      }
      const filtered = all.filter(o => o && Number(o.fusionCustomerId) === id);
      $page.variables.transferFilteredAgreementsArray = filtered.length ? filtered : all;
    }
  }

  return TransferCustomerSelectedChain;
});
