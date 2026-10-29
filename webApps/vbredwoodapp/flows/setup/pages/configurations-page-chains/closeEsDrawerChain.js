define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Close the Equipment Settings drawer. Bound to Cancel/Close and the drawer's
  // on-opened-changed(false), so it must be idempotent.
  class closeEsDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isEsDrawerOpen = false;
    }
  }

  return closeEsDrawerChain;
});
