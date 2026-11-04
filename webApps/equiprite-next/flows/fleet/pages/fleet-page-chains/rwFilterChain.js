define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/equipmentRedwood',
], (ActionChain, Actions, rw) => {
  'use strict';

  // The Redwood view's Smart Search: what was typed and a filter per column. The text, Class, Status (the lane tiles,
  // Tight turnaround among them) and Yard become the page's own text, cls, lane, tight and yard, so both looks filter
  // alike; Unit, Equipment, Request, Project or customer and Next booking narrow the Redwood table only (rwCols).
  // Smart Search applies a picked filter when its list closes.
  class rwFilterChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const f = rw.fleetCriterion(v.rwCriterion);
      v.text = f.text;
      v.lane = f.lane;
      v.tight = f.tight;
      v.cls = f.cls;
      v.yard = f.yard;
      v.rwCols = f.cols;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return rwFilterChain;
});
