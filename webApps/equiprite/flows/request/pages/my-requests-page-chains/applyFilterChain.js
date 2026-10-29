define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Recomputes the table rows and chip counts whenever the data, the search text or a chip changes.
  class applyFilterChain extends ActionChain {
    async run(context, { text }) {
      const { $page, $functions } = context;
      if (text !== undefined && text !== null) {
        $page.variables.searchText = String(text);
      }
      const v = $page.variables;
      v.groupChips = $functions.groups(v.allRows);
      v.filteredRows = $functions.filterRows(v.allRows, v.searchText, v.group, v.source);
    }
  }

  return applyFilterChain;
});
