define([
  'vb/action/actionChain',
], function(ActionChain) {
  'use strict';

  // Remove the agreement CATALOG FILTER only — NOT the agreement context. The
  // SDP's agreementId is gated on agreementFilterActive, so flipping this false
  // drops the agreement scope and the user can browse the FULL catalog. The
  // agreement CONTEXT is deliberately preserved: fromAgreementId, requestOrigin,
  // agreementRateByEquipmentId, agreementLineIdByEquipmentId and the request's
  // customerId all stay — so cart lines already added keep their negotiated
  // rates and their 'agreement' origin, and the request still submits as an
  // agreement order. (Re-applying the filter = set this true again.)
  class CatalogClearAgreementFilterChain extends ActionChain {
    async run(context) {
      var $page = context.$page;
      $page.variables.agreementFilterActive = false;
    }
  }

  return CatalogClearAgreementFilterChain;
});
