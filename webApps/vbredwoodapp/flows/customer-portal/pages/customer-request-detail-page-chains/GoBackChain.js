define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class GoBackChain extends ActionChain {
    async run(context) {
      await Actions.navigateToPage(context, { page: 'customer-my-requests' });
    }
  }

  return GoBackChain;
});

