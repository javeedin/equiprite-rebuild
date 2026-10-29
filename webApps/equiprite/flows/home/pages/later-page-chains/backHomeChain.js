define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class backHomeChain extends ActionChain {
    async run(context) {
      await Actions.navigateToPage(context, { page: 'home' });
    }
  }

  return backHomeChain;
});
