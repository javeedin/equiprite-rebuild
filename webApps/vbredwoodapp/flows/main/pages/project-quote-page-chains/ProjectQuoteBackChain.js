define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class ProjectQuoteBackChain extends ActionChain {
    async run(context) {
      await Actions.navigateToPage(context, { page: 'equipment-requests' });
    }
  }

  return ProjectQuoteBackChain;
});
