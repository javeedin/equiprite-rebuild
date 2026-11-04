define([
  'vb/action/actionChain',
  'resources/js/agreementRules',
  'resources/js/commercialRedwood',
], (ActionChain, A, RW) => {
  'use strict';

  // What the list shows: the chip and the search (New's filterRows), in the chosen order; the chips' counts; the
  // summary. Nothing is read again.
  // The Redwood look (your menu, Look) shows the same agreements as rows of an oj-table, then narrowed by its column
  // filters (Smart Search; rwFilterChain), which only it applies; and every column filter's options with their counts.
  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const rows = v.rows || [];
      v.chips = A.chips(rows);
      v.summary = A.summary(rows);
      v.shown = A.sort(A.filterRows(rows, v.text, v.chip), v.sortKey, v.sortDir);

      v.rwRows = RW.agreementRows(RW.agreementByColumns(v.shown, v.rwCols));
      const opts = RW.agreementOptions(rows);
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      [['rwNumbers', 'number'], ['rwCustomers', 'customer'], ['rwTypes', 'type'], ['rwStatuses', 'chip'], ['rwDates', 'dates'], ['rwLines', 'lines'],
        ['rwNext', 'next']].forEach(([name, key]) => {
        if (!same(v[name], opts[key])) v[name] = opts[key];
      });
    }
  }

  return applyChain;
});
