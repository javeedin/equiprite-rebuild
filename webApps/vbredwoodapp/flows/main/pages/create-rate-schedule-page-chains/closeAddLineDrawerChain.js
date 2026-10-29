define([
  'vb/action/actionChain'
], (ActionChain) => {
  'use strict';

  class closeAddLineDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isAddLineDrawerOpen = false;
    }
  }

  return closeAddLineDrawerChain;
});
