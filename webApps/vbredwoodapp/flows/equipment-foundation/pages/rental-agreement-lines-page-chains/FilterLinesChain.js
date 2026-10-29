define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Client-side search filter on the in-memory linesArray.
  // Matches the searchQuery (lowercase, word-tokenized) against
  // equipment_name, class_name, subClassName, and description.
  // Empty query restores the full array.
  //
  // After filtering, we rebuild the dataGridProvider so oj-data-grid
  // re-renders only the matching rows. Selection is cleared on every
  // filter change — otherwise the row-index entries in _selectedRows
  // (Set on the page module) would point at the wrong line in the new
  // (shorter) filtered array.
  class FilterLinesChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const all = $page.variables.linesArray || [];
      const raw = ($page.variables.searchQuery || '').trim().toLowerCase();

      let filtered;
      if (!raw) {
        filtered = [...all];
      } else {
        const words = raw.split(/\s+/).filter(w => w);
        filtered = all.filter(item => {
          const hay = [
            item.equipment_name,
            item.class_name,
            item.subClassName,
            item.description
          ].map(v => String(v || '').toLowerCase()).join(' ');
          return words.every(w => hay.indexOf(w) !== -1);
        });
      }

      $page.variables.filteredLines    = filtered;
      $page.variables.dataGridProvider = $page.functions.initGridData(filtered);
      $page.functions.clearSelection($page.variables);
    }
  }

  return FilterLinesChain;
});
