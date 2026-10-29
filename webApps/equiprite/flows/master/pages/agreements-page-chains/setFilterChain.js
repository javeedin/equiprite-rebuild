define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // The search box and the status chips (clicking the chip that is on goes back to All), and the rows shown after
  // a load (kind 'apply'). Nothing is read again: the list holds every agreement the old list showed.
  // Typing waits for a short pause, and the grid's rows are replaced only when they differ: replacing them while
  // oj-table is still fetching the previous set makes it abort that fetch with a console error.
  const PAUSE_MS = 150;
  let typing = 0;

  class setFilterChain extends ActionChain {
    async run(context, { kind, value }) {
      const { $page } = context;
      const v = $page.variables;
      if (kind === 'search') {
        v.searchText = value == null ? '' : String(value);
        const mine = ++typing;
        await new Promise((r) => setTimeout(r, PAUSE_MS));
        if (mine !== typing) return;
      } else if (kind === 'chip') {
        v.chip = value && value !== v.chip ? String(value) : 'all';
      }
      const shown = $page.functions.filterRows(v.allRows, v.searchText, v.chip);
      if (!$page.functions.sameRows(v.shownRows, shown)) v.shownRows = shown;
    }
  }

  return setFilterChain;
});
