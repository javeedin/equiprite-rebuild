define([
  'vb/action/actionChain',
  'resources/js/rateRules',
], (ActionChain, R) => {
  'use strict';

  // What the list shows: the chip and the search over the schedules (New's filterSchedules), the chips' counts and
  // the summary. Nothing is read again.
  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const rows = v.schedules || [];
      v.chips = R.listChips(rows);
      v.summary = R.summary(rows);
      v.shown = R.filterSchedules(rows, v.listText, v.listChip);
    }
  }

  return applyChain;
});
