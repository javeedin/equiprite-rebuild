define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (ActionChain, Actions) => {
  'use strict';

  class NavigateBackChain extends ActionChain {
    async run(context) {
      // Navigate back to the Equipment Catalog
      await Actions.navigateToPage(context, {
        page: 'request-catalog'
      });
    }
  }

  return NavigateBackChain;
});
