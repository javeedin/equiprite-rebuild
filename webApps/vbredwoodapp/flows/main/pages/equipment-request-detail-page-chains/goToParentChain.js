define([
  'vb/action/actionChain',
  'vb/action/actions'
], (ActionChain, Actions) => {
  'use strict';

  class goToParentChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const target = $page.variables.returnTo || 'equipment-requests';
      await Actions.navigateToPage(context, {
        page: target
      });
    }
  }

  return goToParentChain;
});
