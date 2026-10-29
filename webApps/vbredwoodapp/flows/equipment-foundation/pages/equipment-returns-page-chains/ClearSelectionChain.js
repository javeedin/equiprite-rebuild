define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class ClearSelectionChain extends ActionChain {
    async run(context) {
      context.$page.variables.selectedIds = [];
    }
  }

  return ClearSelectionChain;
});
