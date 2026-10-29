define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Fired when the Customer dropdown value changes (select or clear).
  // Filters the Rental Agreement LOV to only show agreements whose
  // fusionCustomerId matches the selected Fusion CustomerId.
  // On clear (fusionCustomerId == null), restores the full list.
  //
  // Also clears any selected agreement if it no longer belongs to the
  // newly selected customer (avoids a mismatched customer+agreement pair).
  class CustomerSelectedChain extends ActionChain {
    async run(context, { fusionCustomerId } = {}) {
      const { $page, $flow } = context;

      const selectedId = (fusionCustomerId != null && fusionCustomerId !== '')
        ? Number(fusionCustomerId) : null;

      $page.variables.customerFilterId = selectedId;

      const allOptions = $page.variables.agreementOptionsArray || [];

      if (selectedId == null) {
        // Customer cleared — restore full agreement list
        $page.variables.filteredAgreementsArray = allOptions;
      } else {
        // Filter to agreements with matching fusionCustomerId.
        // Agreements where fusionCustomerId is null (created before this
        // feature) are excluded — they can't be matched to a customer.
        $page.variables.filteredAgreementsArray = allOptions.filter(function(o) {
          return o.fusionCustomerId != null && Number(o.fusionCustomerId) === selectedId;
        });
      }

      // If there is a currently selected agreement that doesn't belong to
      // the new customer, clear it to avoid a mismatched pair.
      const currentAgreementId = $page.variables.selectedAgreementId;
      if (currentAgreementId != null) {
        const stillValid = $page.variables.filteredAgreementsArray.some(function(o) {
          return Number(o.value) === Number(currentAgreementId);
        });
        if (!stillValid) {
          $page.variables.selectedAgreementId = null;
          // Delegate to AgreementSelectedChain clear path to wipe context
          await Actions.callChain(context, {
            chain: 'AgreementSelectedChain',
            params: { agreementId: null }
          });
        }
      }
    }
  }

  return CustomerSelectedChain;
});
