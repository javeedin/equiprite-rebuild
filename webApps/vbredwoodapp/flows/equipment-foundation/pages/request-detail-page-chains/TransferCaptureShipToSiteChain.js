define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /** Mirrors CaptureShipToSiteChain, scoped to transfer* page variables. */
  class TransferCaptureShipToSiteChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page } = context;
      $page.variables.transferLocation              = data ? data.SITE_ADDRESS : '';
      $page.variables.transferSelectedShipToSiteObj = data || null;
    }
  }

  return TransferCaptureShipToSiteChain;
});
