define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class cancelChain extends ActionChain {
    async run(context) {
      console.log('--- cancelChain triggered ---');
      await Actions.navigateToPage(context, {
        page: 'rental-agreements'
      });
    }
  }

  return cancelChain;
});
