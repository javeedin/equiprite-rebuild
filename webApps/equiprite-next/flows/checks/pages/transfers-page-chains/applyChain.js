define([
  'vb/action/actionChain',
  'resources/js/transferList',
], (ActionChain, list) => {
  'use strict';

  // What the list shows: every transfer order (and every inter-project transfer on record without one) in words, the
  // chips, the kind, the search and the sort applied. Worked out first, then set.
  // The Redwood view (your menu, Look) shows the same transfers as oj-table rows, narrowed further by the column filters
  // only it shows (rwCols), with every filter's options and their counts.
  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const now = Date.now();
      const ctx = { orgs: v.orgs, requests: v.requests, toLines: v.toLines, lines: v.lines, history: v.history, now };
      const all = (v.orders || []).concat(list.historyOnly(v.orders, v.history)).map((o) => list.decorate(o, ctx));
      const shown = list.sort(list.filter(all, v.chip, v.kind, v.text), v.sortKey, v.sortDir);
      const chips = list.chips(all);
      const kinds = list.kinds(all);
      v.rows = all;
      v.chips = chips;
      v.kindChips = kinds;
      v.summary = list.summary(all);
      v.shown = shown;

      const rwShown = list.byColumns(shown, v.rwCols, now);
      v.rwShown = rwShown;
      v.rwRows = list.redwoodRows(rwShown);
      const opts = list.columnOptions(all, chips, kinds, now);
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      [['rwNumbers', 'number'], ['rwRequests', 'request'], ['rwRoutes', 'route'], ['rwWhat', 'what'], ['rwChips', 'chip'], ['rwDue', 'due'],
        ['rwKinds', 'kind']].forEach(([name, key]) => {
        if (!same(v[name], opts[key])) v[name] = opts[key];
      });
    }
  }

  return applyChain;
});
