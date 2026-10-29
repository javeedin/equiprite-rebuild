define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class backToListChain extends ActionChain {
    async run(context) {
      await Actions.navigateToPage(context, { page: 'my-requests' });
    }
  }

  return backToListChain;
});
