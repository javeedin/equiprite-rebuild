define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class selectedKeyChangedChain extends ActionChain {
    async run(context, params) {
      const { $fragment } = context;
      // If the caller explicitly nulls out the selected key, we should clear the search text and selected item
      if (params.value === null || params.value === '' || params.value === undefined) {
        $fragment.variables.searchText = '';
        $fragment.variables.selectedItem = null;
        $fragment.variables.selectedItemName = '';
      }
    }
  }

  return selectedKeyChangedChain;
});
