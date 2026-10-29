
define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class navigateToCreateChain extends ActionChain {
    async run(context) {
      // Placeholder: Keep original or update if rate-schedule-create exists
      await Actions.navigateToPage(context, {
        page: 'create-rate-schedule'
      });
    }
  }

  return navigateToCreateChain;
});
