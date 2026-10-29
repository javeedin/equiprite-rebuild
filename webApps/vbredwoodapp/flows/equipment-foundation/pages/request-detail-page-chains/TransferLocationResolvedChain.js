define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /**
   * Writes a Transfer-drawer map geocode/reverse-geocode result into page
   * variables. Mirrors LocationResolvedChain — writes only the structured
   * address fields; the composed transferLocation string is written
   * separately by TransferUseLocationChain when the user confirms the pick.
   */
  class TransferLocationResolvedChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page } = context;
      const d = data || {};
      $page.variables.transferAddr1      = d.addr1      || '';
      $page.variables.transferAddr2      = d.addr2      || '';
      $page.variables.transferCity       = d.city       || '';
      $page.variables.transferCounty     = d.county     || '';
      $page.variables.transferAddrState  = d.state      || '';
      $page.variables.transferPostalCode = d.postalCode || '';
      $page.variables.transferCountry    = d.country    || '';
      $page.variables.transferPickedLat  = (d.lat != null) ? d.lat : null;
      $page.variables.transferPickedLng  = (d.lng != null) ? d.lng : null;
    }
  }

  return TransferLocationResolvedChain;
});
