define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class NavigateBackChain extends ActionChain {
    async run(context) {
      await Actions.navigateBack(context, {});
    }
  }

  return NavigateBackChain;
});
