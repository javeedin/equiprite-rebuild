define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Recomputes the shown rows, the chip counts and the map whenever the loaded rows or a client chip change.
  //
  // Clear filters changes several variables at once and the list arrives page by page, so this runs in bursts.
  // Each run waits a moment and only the last of a burst writes; the grid's rows are replaced only when the
  // shown rows really differ. Replacing them while oj-table is still fetching the previous set makes it abort
  // that fetch with a console error ("Aborting stale fetch").
  const SETTLE_MS = 100;
  let latest = 0;

  class applyFilterChain extends ActionChain {
    async run(context) {
      const mine = ++latest;
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      if (mine !== latest) return;
      const { $page } = context;
      const $functions = $page.functions;
      const v = $page.variables;
      const rows = v.allRows || [];
      v.statusChips = $functions.statusChips(rows);
      v.trackingChips = $functions.trackingChips(rows);
      v.sourceChips = $functions.sourceChips(rows);
      // The map counts the rows the chips leave, before its own location pick.
      const chipped = $functions.filterRows(rows, v.statusFilter, v.trackingFilter, v.sourceFilter, '');
      v.map = $functions.mapPoints(chipped, v.locations);
      const shown = v.mapLocation ? $functions.filterRows(chipped, 'all', '', '', v.mapLocation) : chipped;
      if (!$functions.sameRows(v.shownRows, shown)) v.shownRows = shown;
    }
  }

  return applyFilterChain;
});
