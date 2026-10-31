define([
  'vb/action/actionChain',
  'resources/js/costPosting',
], (ActionChain, costPosting) => {
  'use strict';

  // Ticking what to post, and opening a week's days: New's treeChain (toggleWeekChain, toggleGroupSelectChain,
  // toggleMiscChain, selectAllPastChain, toggleWeekDaysChain), by its rules (costPosting.tick): only a postable week
  // can be ticked, only a charge not posted; each tick re-stamps every equipment's "all weeks" box. 'all' and 'none'
  // tick or untick every week and charge ready. What is unticked is remembered by key, so a read keeps it unticked.
  // Nothing while posting, and nothing for a role that may only look.
  class treeChain extends ActionChain {
    async run(context, { action, key, checked }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      if (v.isPosting || v.readOnly) return;
      const all = v.rowsAll || [];
      if (action === 'toggleDays') {
        v.rowsAll = costPosting.toggleDays(all, key);
        return;
      }
      const rows = costPosting.tick(all, action, key, checked === true || checked === 'true');
      if (!rows) {
        // a box the rules refuse: draw it back as it was
        v.rowsAll = all.slice();
        return;
      }
      const plan = costPosting.plan(rows, fns.hdrOf(v.row), v.row && v.row.rateScheduleId);
      v.unticked = costPosting.untickedOf(rows);
      v.rowsAll = rows;
      v.plan = plan;
      v.postError = '';
    }
  }

  return treeChain;
});
