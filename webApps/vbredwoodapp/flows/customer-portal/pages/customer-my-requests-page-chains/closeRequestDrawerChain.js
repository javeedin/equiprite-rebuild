define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class closeRequestDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isDrawerOpen = false;
      $page.variables.selectedRequest = {};
    }
  }

  return closeRequestDrawerChain;
});
