define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Close the misc-charge drawer, discarding the in-progress draft.
  class closeMiscDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isMiscDrawerOpen = false;
      $page.variables.miscFormError = '';
    }
  }

  return closeMiscDrawerChain;
});
