define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /**
   * Capture the customer picked in the EXTERNAL Customer Name LOV.
   *
   * Mirrors customer-create-req-page CustomerSelectedChain, but writes to
   * $flow.variables.request (this page's model lives on the flow so it survives
   * the catalog round-trip) instead of that page's $page.variables.formData.
   *
   * customerRefId is an EQR_CUSTOMER_REF id — a DIFFERENT id space from
   * request.customerId, which the INTERNAL flow fills from the Fusion
   * ShippingCustomersLOV. They are kept as separate fields rather than shared,
   * so a user who fills one, switches type, and fills the other can't end up
   * with a Fusion party id being posted as an EQR customer ref (or vice versa).
   * NavigateToCatalogChain picks whichever matches the chosen type.
   *
   * The Customer Contact LOV is INDEPENDENT of this selection (no DB
   * relationship between customer and portal user), so nothing is filtered or
   * cleared here.
   */
  class CaptureExternalCustomerChain extends ActionChain {
    async run(context, params) {
      const { $flow } = context;
      const data = params && params.data;

      if (!data || data.id == null) {
        $flow.variables.request.customerRefId   = null;
        $flow.variables.request.customerRefName = '';
        return;
      }

      $flow.variables.request.customerRefId   = Number(data.id);
      $flow.variables.request.customerRefName = data.customerName || '';
    }
  }

  return CaptureExternalCustomerChain;
});
