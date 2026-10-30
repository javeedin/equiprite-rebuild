define([
  'vb/action/actionChain',
  'resources/js/transferList',
], (ActionChain, list) => {
  'use strict';

  // What the list shows: every transfer order (and every inter-project transfer on record without one) in words, the
  // chips, the kind, the search and the sort applied. Worked out first, then set.
  class applyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const ctx = { orgs: v.orgs, requests: v.requests, toLines: v.toLines, lines: v.lines, history: v.history, now: Date.now() };
      const all = (v.orders || []).concat(list.historyOnly(v.orders, v.history)).map((o) => list.decorate(o, ctx));
      const shown = list.sort(list.filter(all, v.chip, v.kind, v.text), v.sortKey, v.sortDir);
      v.rows = all;
      v.chips = list.chips(all);
      v.kindChips = list.kinds(all);
      v.summary = list.summary(all);
      v.shown = shown;
    }
  }

  return applyChain;
});
