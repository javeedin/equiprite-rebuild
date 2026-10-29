define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (ActionChain, Actions) => {
  'use strict';

  class GoToParentChain extends ActionChain {
    async run(context) {
      await Actions.navigateToPage(context, {
        page: 'request-catalog'
      });
    }
  }

  return GoToParentChain;
});
