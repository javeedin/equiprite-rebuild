define([
  'vb/action/actionChain',
  'resources/js/rateRules',
  'resources/js/commercialRedwood',
], (ActionChain, R, RW) => {
  'use strict';

  // What the list shows: the chip and the search over the schedules (New's filterSchedules), the chips' counts and
  // the summary. Nothing is read again.
  // The Redwood look (your menu, Look) shows the same schedules as rows of an oj-table, then narrowed by its column
  // filters (Smart Search; rwFilterChain), which only it applies; and every column filter's options with their counts.
  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const rows = v.schedules || [];
      v.chips = R.listChips(rows);
      v.summary = R.summary(rows);
      v.shown = R.filterSchedules(rows, v.listText, v.listChip);

      v.rwRows = RW.rateRows(RW.rateByColumns(v.shown, v.rwCols));
      const opts = RW.rateOptions(rows);
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      [['rwNames', 'name'], ['rwUsedBy', 'usedBy'], ['rwDates', 'dates'], ['rwCurrencies', 'currency'], ['rwStatuses', 'chip']].forEach(([name, key]) => {
        if (!same(v[name], opts[key])) v[name] = opts[key];
      });
    }
  }

  return applyChain;
});
