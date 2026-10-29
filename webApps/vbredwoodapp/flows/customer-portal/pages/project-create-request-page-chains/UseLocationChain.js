define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // "Use this location" in the drawer. Composes the (possibly user-edited)
  // Oracle-style address components into a single readable line and shows it in
  // the Delivery Location field ($flow.variables.request.location), then closes.
  //   "<Address1>, <Address2>, <City>, <County>, <State> <ZIP>, <Country>"
  //
  // NOTE: the structured components + coords still live on the page variables
  // (addr1/addr2/city/county/addrState/postalCode/country/pickedLat/pickedLng)
  // for the persistence step — this only sets the visible label.
  class UseLocationChain extends ActionChain {
    async run(context) {
      const { $page, $flow } = context;
      const v = $page.variables;

      const stateZip = [v.addrState, v.postalCode]
        .filter(function (s) { return s && String(s).trim(); })
        .join(' ');

      const line = [v.addr1, v.addr2, v.city, v.county, stateZip, v.country]
        .filter(function (s) { return s && String(s).trim(); })
        .join(', ');

      if (line && $flow.variables.request) {
        $flow.variables.request.location = line;
      }
      $page.variables.isLocationDrawerOpen = false;
    }
  }

  return UseLocationChain;
});
