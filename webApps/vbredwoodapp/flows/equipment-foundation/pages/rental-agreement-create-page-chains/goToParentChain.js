define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class goToParentChain extends ActionChain {
    async run(context) {
      await Actions.navigateToPage(context, {
        page: 'rental-agreements',
      });
    }
  }

  return goToParentChain;
});
