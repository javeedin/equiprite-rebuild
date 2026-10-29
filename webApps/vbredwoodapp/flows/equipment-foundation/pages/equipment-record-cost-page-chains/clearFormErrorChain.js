define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // A missing-field message belongs to the tab it was raised on.
  class clearFormErrorChain extends ActionChain {
    async run(context) {
      context.$page.variables.formError = '';
    }
  }

  return clearFormErrorChain;
});
