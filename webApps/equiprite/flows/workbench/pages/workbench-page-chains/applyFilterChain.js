define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Recomputes the visible rows, the stage summary and the selection bar after a load, a tab, a chip, the search or
  // a tick. The selection counts only ticked rows that are on screen, so a bulk action never touches a hidden row.
  class applyFilterChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const f = $page.functions;
      const rows = (v.buckets && v.buckets[v.tab]) || [];
      v.visibleRows = f.filterRows(rows, v.searchText, v.source);
      v.stageNote = f.stageSummary(v.tab, rows);
      v.selection = f.selectionSummary(v.tab === 'approve' ? v.visibleRows : [], v.selectedIds);
    }
  }

  return applyFilterChain;
});
