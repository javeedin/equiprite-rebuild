define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class browseCatalogChain extends ActionChain {

    async run(context) {
      await Actions.navigateToPage(context, { page: 'request-catalog' });
    }
  }

  return browseCatalogChain;
});
