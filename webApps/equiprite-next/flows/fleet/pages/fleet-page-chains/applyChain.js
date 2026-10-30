define([
  'vb/action/actionChain',
  'resources/js/equipmentBoard',
], (ActionChain, board) => {
  'use strict';

  // What is shown: the lane tiles count the whole fleet (class, yard and search applied, the lane not), the board or
  // list shows the chosen lane. Worked out first, the view switched last.
  class applyChain extends ActionChain {
    async run(context, params) {
      const v = context.$page.variables;
      const view = (params && params.view) || v.view;
      const base = board.filter(v.units, { text: v.text, cls: v.cls, yard: v.yard });
      const shown = board.filter(base, { lane: v.lane, tightOnly: v.tight });
      const lanes = view === 'board' ? board.lanes(shown, 40) : [];
      if (view !== v.view) {
        v.shown = [];
        v.lanes = [];
        v.view = view;
      }
      v.sum = board.summary(base);
      v.classes = board.options(v.units, 'cls', 10);
      v.yards = board.options(v.units, 'yard', 8);
      v.lanes = lanes;
      v.shown = shown;
    }
  }

  return applyChain;
});
