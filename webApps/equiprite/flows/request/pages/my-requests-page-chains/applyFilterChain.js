define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Search, status chips and source for both views. Requests: the request's own fields and its equipment.
  // Equipment: every line, joined to its request, by the line's own status.
  class applyFilterChain extends ActionChain {
    async run(context, { text }) {
      const { $page, $functions } = context;
      if (text !== undefined && text !== null) {
        $page.variables.searchText = String(text);
      }
      const v = $page.variables;
      const lines = $functions.flattenLines(v.allRows, v.linesByRequest);
      v.allLines = lines;
      v.groupChips = v.view === 'equipment' ? $functions.lineGroups(lines) : $functions.groups(v.allRows);
      v.filteredRows = $functions.filterRows(v.allRows, v.searchText, v.group, v.source, v.linesByRequest);
      v.filteredLines = $functions.filterLines(lines, v.searchText, v.group, v.source);
    }
  }

  return applyFilterChain;
});
