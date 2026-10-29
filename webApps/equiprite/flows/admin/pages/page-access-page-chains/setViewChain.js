define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Page-only view state: the page search and the preview mode (with the pending changes, or as saved).
  class setViewChain extends ActionChain {
    async run(context, { search, previewMode }) {
      const { $page } = context;
      if (search !== undefined && search !== null) {
        $page.variables.searchText = String(search);
      }
      if (previewMode === 'pending' || previewMode === 'saved') {
        $page.variables.previewMode = previewMode;
      }
    }
  }

  return setViewChain;
});
