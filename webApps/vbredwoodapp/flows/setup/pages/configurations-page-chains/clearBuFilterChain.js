define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Clear the BU filter — table shows all BUs again.
  class clearBuFilterChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.BuOrgFilterBUId = null;
    }
  }

  return clearBuFilterChain;
});
