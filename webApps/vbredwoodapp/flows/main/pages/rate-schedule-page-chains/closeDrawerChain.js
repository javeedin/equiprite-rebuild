
define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class closeDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isDrawerOpen = false;
    }
  }

  return closeDrawerChain;
});
