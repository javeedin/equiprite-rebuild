define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Chip, search text and "Show more". The filtering itself is customer-requests-page.js filterRows.
  const PAGE = 40;

  class filterChain extends ActionChain {
    async run(context, { group, text, more }) {
      const { $page } = context;
      if (more) {
        $page.variables.limit = ($page.variables.limit || PAGE) + PAGE;
        return;
      }
      if (group) {
        $page.variables.group = group;
      }
      if (text !== undefined && text !== null) {
        $page.variables.searchText = String(text);
      }
      $page.variables.limit = PAGE;
    }
  }

  return filterChain;
});
