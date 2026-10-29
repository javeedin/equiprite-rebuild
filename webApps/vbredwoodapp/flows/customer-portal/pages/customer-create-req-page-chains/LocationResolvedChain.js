define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Fired (via the locationResolved page event) after the map module parses a
  // geocode result into Oracle-style address components. The module can't write
  // $page.variables, so it hands the parsed object here and this chain writes
  // the drawer's bound fields. `data` = { addr1, addr2, city, county, state,
  // postalCode, country, lat, lng, formatted }.
  class LocationResolvedChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page } = context;
      const d = data || {};
      $page.variables.addr1      = d.addr1      || '';
      $page.variables.addr2      = d.addr2      || '';
      $page.variables.city       = d.city       || '';
      $page.variables.county     = d.county     || '';
      $page.variables.addrState  = d.state      || '';
      $page.variables.postalCode = d.postalCode || '';
      $page.variables.country    = d.country    || '';
      $page.variables.pickedLat  = (d.lat != null) ? d.lat : null;
      $page.variables.pickedLng  = (d.lng != null) ? d.lng : null;
    }
  }

  return LocationResolvedChain;
});
