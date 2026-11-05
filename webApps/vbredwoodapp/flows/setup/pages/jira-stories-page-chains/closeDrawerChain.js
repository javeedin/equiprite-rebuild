define([
  'vb/action/actionChain'
], (ActionChain) => {
  'use strict';

  // The drawer's Close (Escape closes it too: oj-drawer-popup writes drawerOpen back).
  class closeDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.drawerOpen = false;
    }
  }

  return closeDrawerChain;
});
