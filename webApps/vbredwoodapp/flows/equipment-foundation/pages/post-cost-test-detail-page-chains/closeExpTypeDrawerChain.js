define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Close the Expenditure Type drawer, discarding the in-progress choice.
  class closeExpTypeDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.isExpTypeDrawerOpen = false;
      $page.variables.expTypeFormError = '';
    }
  }

  return closeExpTypeDrawerChain;
});
