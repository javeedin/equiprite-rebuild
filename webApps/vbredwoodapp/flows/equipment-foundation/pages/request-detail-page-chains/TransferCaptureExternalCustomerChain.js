define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /** Mirrors CaptureExternalCustomerChain, scoped to transfer* page variables. */
  class TransferCaptureExternalCustomerChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const data = params && params.data;

      if (!data || data.id == null) {
        $page.variables.transferCustomerId   = null;
        $page.variables.transferCustomerName = '';
        return;
      }

      $page.variables.transferCustomerId   = Number(data.id);
      $page.variables.transferCustomerName = data.customerName || '';
    }
  }

  return TransferCaptureExternalCustomerChain;
});
