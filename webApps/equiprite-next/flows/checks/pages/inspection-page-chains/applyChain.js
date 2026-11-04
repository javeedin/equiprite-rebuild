define([
  'vb/action/actionChain',
  'resources/js/inspectionQueue',
], (ActionChain, Q) => {
  'use strict';

  // What the queue shows: New's queue (asked for or everything waiting) in this screen's words, the chips, the chip
  // and the search applied, the summary. Worked out first, then set, so the list never sees half of a change.
  // The Redwood view (your menu, Look) shows the same units as oj-table rows, narrowed further by the column filters
  // only it shows (rwCols), with every filter's options and their counts.
  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const now = Date.now();
      const entries = Q.entries(v.lines, v.matrix, v.scope, now);
      const chips = Q.chips(entries);
      const shown = Q.filter(entries, v.chip, v.text);
      v.entries = entries;
      v.chips = chips;
      v.summary = Q.summary(entries);
      v.shown = shown;

      const rwShown = Q.byColumns(shown, v.rwCols, now);
      v.rwShown = rwShown;
      v.rwRows = Q.redwoodRows(rwShown);
      const other = Q.entries(v.lines, v.matrix, v.scope === 'all' ? 'required' : 'all', now).length;
      const opts = Q.columnOptions(entries, chips, v.scope === 'all' ? { all: entries.length, required: other } : { required: entries.length, all: other }, now);
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      [['rwUnits', 'unit'], ['rwRequests', 'request'], ['rwChips', 'chip'], ['rwWhen', 'when'], ['rwScopes', 'scope']].forEach(([name, key]) => {
        if (!same(v[name], opts[key])) v[name] = opts[key];
      });
    }
  }

  return applyChain;
});
