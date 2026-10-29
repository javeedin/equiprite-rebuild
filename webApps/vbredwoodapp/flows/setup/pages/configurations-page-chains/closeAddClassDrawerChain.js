define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Close the add-class/subclass drawer without saving.
  class closeAddClassDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isAddClassDrawerOpen = false;
    }
  }

  return closeAddClassDrawerChain;
});
