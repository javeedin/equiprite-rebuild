define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (ActionChain, Actions) => {
  'use strict';

  class CreateRequestBackChain extends ActionChain {
    async run(context) {
      // Go back to the dashboard or my requests
      await Actions.navigateToPage(context, {
        page: 'customer-dashboard'
      });
    }
  }

  return CreateRequestBackChain;
});
