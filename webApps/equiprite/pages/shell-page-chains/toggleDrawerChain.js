define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Header menu button: shows or hides the side menu on narrow windows.
  class toggleDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isDrawerOpen = !$page.variables.isDrawerOpen;
    }
  }

  return toggleDrawerChain;
});
