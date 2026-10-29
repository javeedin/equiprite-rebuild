define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Recomputes $page.variables.lineSelectionState whenever a row/header
  // checkbox on the Equipment Lines grid changes, so the Accept button's
  // disabled state stays in sync.
  class LineSelectionChangedChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const raw = ($page.functions.getLineSelectionStateRaw && $page.functions.getLineSelectionStateRaw())
        || { count: 0 };

      $page.variables.lineSelectionState = { count: raw.count };

      // Bump tick so row/header checkbox :checked bindings re-evaluate after
      // a select-all/clear-all (rows the user didn't individually click).
      $page.variables.lineSelectionTick = ($page.variables.lineSelectionTick || 0) + 1;
    }
  }

  return LineSelectionChangedChain;
});
