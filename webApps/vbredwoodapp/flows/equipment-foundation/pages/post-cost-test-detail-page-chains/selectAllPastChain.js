define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Select every postable (past, not-yet-posted) week; if all are already
  // selected, clear instead (toggle). Keeps per-row `selected` + selectedWeekKeys in sync.
  class selectAllPastChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const all0 = $page.variables.rowsAll || [];

      const postable = all0.filter(function (r) { return r.kind === 'week' && r.postable && !r.posted; });
      const postableKeys = postable.map(function (r) { return r.rowKey; });
      const allSelected = postableKeys.length > 0 && postable.every(function (r) { return r.selected; });
      const nextSelected = !allSelected; // if not all selected → select all; else clear

      let all = all0.map(function (r) {
        if (r.kind === 'week' && r.postable && !r.posted) {
          return Object.assign({}, r, { selected: nextSelected });
        }
        return r;
      });

      // refresh each group row's per-equipment selection state (drives the
      // group-row "Select all / Clear" link + label).
      all = all.map(function (r) {
        if (r.kind !== 'group') return r;
        const wk = all.filter(function (x) {
          return x.kind === 'week' && x.groupKey === r.groupKey && x.postable && !x.posted;
        });
        const hasP = wk.length > 0;
        return Object.assign({}, r, { hasPostable: hasP, allSelected: hasP && wk.every(function (x) { return x.selected; }) });
      });

      const sel = nextSelected ? postableKeys.slice() : [];

      // Shared filter. This chain previously used a 2-level version that stopped
      // at `g && g.expanded`, which revealed a week's DAY rows even when that
      // week was collapsed.
      $page.variables.rowsAll = all;
      $page.variables.rowsVisible = $page.functions.visibleRows(all);
      $page.variables.selectedWeekKeys = sel;
    }
  }

  return selectAllPastChain;
});
