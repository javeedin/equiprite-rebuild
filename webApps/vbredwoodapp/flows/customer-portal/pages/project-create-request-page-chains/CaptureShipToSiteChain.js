define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Fired by the plain Ship-to-Site oj-select-single's on-value-item-changed.
  // The row's .id/.label are both SITE_ADDRESS (see LoadShipToSitesChain) — the
  // selected item IS the delivery address string, so it writes straight into
  // request.location, the field every downstream consumer (geocoder,
  // NavigateToCatalogChain validation, SubmitRequestChain) already reads.
  class CaptureShipToSiteChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page, $flow } = context;
      // No row: either the user cleared the picker (its value binding has
      // already emptied request.location) or the site list is still loading on
      // a return from the catalog. Neither should touch the address.
      if (!data) {
        $page.variables.selectedShipToSiteObj = null;
        return;
      }
      $flow.variables.request.location       = data.SITE_ADDRESS;
      $page.variables.selectedShipToSiteObj  = data;
    }
  }

  return CaptureShipToSiteChain;
});
