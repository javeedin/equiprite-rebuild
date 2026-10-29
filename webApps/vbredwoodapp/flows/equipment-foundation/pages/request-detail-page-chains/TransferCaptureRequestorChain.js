define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /** Mirrors CaptureRequestorChain, scoped to transfer* page variables. */
  class TransferCaptureRequestorChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page } = context;
      if (data) {
        $page.variables.transferRequestorId   = data.id       || null;
        $page.variables.transferRequestorName = data.fullName || '';
      }
    }
  }

  return TransferCaptureRequestorChain;
});
