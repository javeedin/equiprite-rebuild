define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /**
   * Mirrors CaptureExternalContactChain. Writes into the SAME
   * transferRequestorId/transferRequestorName fields the internal Requestor
   * Contact picker uses — the two are mutually exclusive on screen, same
   * convention the real create-request page follows.
   */
  class TransferCaptureExternalContactChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const data = params && params.data;

      if (!data || data.id == null) {
        $page.variables.transferRequestorId   = null;
        $page.variables.transferRequestorName = '';
        return;
      }

      $page.variables.transferRequestorId   = Number(data.id);
      $page.variables.transferRequestorName = data.contactName || '';
    }
  }

  return TransferCaptureExternalContactChain;
});
