define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // "Use this location" in the drawer. Composes the (possibly user-edited)
  // Oracle-style address components into a single readable line and shows it in
  // the Delivery Location field ($page.variables.formData.location), then closes.
  //   "<Address1>, <Address2>, <City>, <County>, <State> <ZIP>, <Country>"
  //
  // The structured components + coords still live on the page variables
  // (addr1/addr2/city/county/addrState/postalCode/country/pickedLat/pickedLng)
  // for a later persistence step — this only sets the visible label.
  class UseLocationChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;

      const stateZip = [v.addrState, v.postalCode]
        .filter(function (s) { return s && String(s).trim(); })
        .join(' ');

      const line = [v.addr1, v.addr2, v.city, v.county, stateZip, v.country]
        .filter(function (s) { return s && String(s).trim(); })
        .join(', ');

      if (line && $page.variables.formData) {
        $page.variables.formData.location = line;
      }
      $page.variables.isLocationDrawerOpen = false;
    }
  }

  return UseLocationChain;
});
