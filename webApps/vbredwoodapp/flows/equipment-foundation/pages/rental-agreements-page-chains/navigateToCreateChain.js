define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class navigateToCreateChain extends ActionChain {
    async run(context) {
      console.log('--- navigateToCreateChain triggered ---');
      await Actions.navigateToPage(context, {
        page: 'rental-agreement-create'
      });
    }
  }

  return navigateToCreateChain;
});
