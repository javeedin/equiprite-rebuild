define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (ActionChain, Actions) => {
  'use strict';

  class goToParentChain extends ActionChain {
    async run(context) {
      await Actions.navigateToPage(context, {
        page: 'equipment-workbench'
      });
    }
  }

  return goToParentChain;
});
