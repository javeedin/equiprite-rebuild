define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (
  ActionChain,
  Actions,
  ActionUtils
) => {
  'use strict';

  class closeRequestDrawerChain extends ActionChain {
    async run(context) {
      context.$page.variables.isDrawerOpen = false;
    }
  }

  return closeRequestDrawerChain;
});
