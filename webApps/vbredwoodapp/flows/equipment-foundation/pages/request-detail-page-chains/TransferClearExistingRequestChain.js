define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /** Clears the picked existing-request summary card so the user can search again. */
  class TransferClearExistingRequestChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.transferSelectedExistingRequest = null;
      $page.variables.transferExistingRequestSearch    = '';
      $page.variables.transferExistingRequestError     = '';
    }
  }

  return TransferClearExistingRequestChain;
});
