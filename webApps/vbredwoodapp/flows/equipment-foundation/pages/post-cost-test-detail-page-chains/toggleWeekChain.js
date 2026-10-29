define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Toggle one week's selection. The checkbox carries id="wk-<rowKey>"; read the
  // key + checked state off event.target (mirrors equipment-returns RowCheckboxChangedChain).
  // Maintains BOTH: a per-row `selected` boolean (drives the checked/unchecked
  // template branches) AND the selectedWeekKeys array (drives the Post button count).
  class toggleWeekChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      const el = event && event.target;
      if (!el || !el.id || el.id.indexOf('wk-') !== 0) return;
      const weekKey  = el.id.replace('wk-', '');
      const isChecked = !!el.checked;

      // guard: only postable week rows are selectable
      const target = ($page.variables.rowsAll || []).find(function (r) { return r.rowKey === weekKey; });
      if (!target || !target.postable) return;

      let all = ($page.variables.rowsAll || []).map(function (r) {
        if (r.rowKey === weekKey) {
          return Object.assign({}, r, { selected: isChecked });
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

      const sel = (all.filter(function (r) { return r.kind === 'week' && r.selected; })
                      .map(function (r) { return r.rowKey; }));

      // Shared filter — see selectAllPastChain for why the inline version went.
      $page.variables.rowsAll = all;
      $page.variables.rowsVisible = $page.functions.visibleRows(all);
      $page.variables.selectedWeekKeys = sel;
    }
  }

  return toggleWeekChain;
});
