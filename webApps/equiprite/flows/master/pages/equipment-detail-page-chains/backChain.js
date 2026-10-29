define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Back to the Equipment list (the old goToParentChain went to equipment-master).
  class backChain extends ActionChain {
    async run(context) {
      await Actions.navigateToPage(context, { page: 'equipment' });
    }
  }

  return backChain;
});
