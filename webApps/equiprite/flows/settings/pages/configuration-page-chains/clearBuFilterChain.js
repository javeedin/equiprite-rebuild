define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/clearBuFilterChain.js, unchanged.

  // Clear the BU filter — table shows all BUs again.
  class clearBuFilterChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.BuOrgFilterBUId = null;
    }
  }

  return clearBuFilterChain;
});
