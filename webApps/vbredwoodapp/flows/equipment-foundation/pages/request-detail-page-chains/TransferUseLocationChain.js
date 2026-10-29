define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /**
   * "Use this location" — composes the structured address fields into the
   * single transferLocation string and closes the map drawer. Mirrors
   * UseLocationChain (which writes $flow.variables.request.location; this
   * page has no flow-level request model, so it writes the page-scoped
   * transferLocation instead).
   */
  class TransferUseLocationChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;

      const stateZip = [v.transferAddrState, v.transferPostalCode]
        .filter(function (s) { return s && String(s).trim(); })
        .join(' ');

      const line = [v.transferAddr1, v.transferAddr2, v.transferCity, v.transferCounty, stateZip, v.transferCountry]
        .filter(function (s) { return s && String(s).trim(); })
        .join(', ');

      if (line) {
        $page.variables.transferLocation = line;
      }
      $page.variables.transferIsLocationDrawerOpen = false;
    }
  }

  return TransferUseLocationChain;
});
