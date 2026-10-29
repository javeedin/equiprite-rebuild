define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Shows or hides the full rental terms.
  class toggleTermsChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.showTerms = !$page.variables.showTerms;
    }
  }

  return toggleTermsChain;
});
