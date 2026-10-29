define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/closeAddClassDrawerChain.js, unchanged.

  // Close the add-class/subclass drawer without saving.
  class closeAddClassDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isAddClassDrawerOpen = false;
    }
  }

  return closeAddClassDrawerChain;
});
