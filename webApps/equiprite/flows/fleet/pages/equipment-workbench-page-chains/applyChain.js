define([
  'vb/action/actionChain',
  'resources/js/equipmentBoard',
], (ActionChain, board) => {
  'use strict';

  // Search, class, yard, lane and "tight turnarounds" over the units; rebuilds the board, the list and the chips.
  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const f = { text: v.text, cls: v.cls, yard: v.yard, lane: v.lane, tightOnly: v.tightOnly };
      // The lane tiles and the board count everything else that is chosen, but not the lane itself.
      const noLane = board.filter(v.units, Object.assign({}, f, { lane: 'all' }));
      v.summary = board.summary(noLane);
      v.board = board.lanes(noLane, 30);
      v.filtered = board.filter(v.units, f);
      v.classOptions = board.options(v.units, 'cls', 14);
      v.yardOptions = board.options(v.units, 'yard', 10);
      if (v.selected && !v.units.some((u) => u.key === v.selected.key)) v.selected = null;
    }
  }

  return applyChain;
});
