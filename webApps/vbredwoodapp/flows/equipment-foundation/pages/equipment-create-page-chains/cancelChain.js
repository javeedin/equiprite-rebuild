define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class CancelChain extends ActionChain {
    async run(context) {
      await Actions.navigateToPage(context, {
        page: 'equipment-master'
      });
    }
  }

  return CancelChain;
});
