define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class showMoreChain extends ActionChain {
    async run(context) {
      context.$page.variables.limit = (context.$page.variables.limit || 40) + 40;
    }
  }

  return showMoreChain;
});
