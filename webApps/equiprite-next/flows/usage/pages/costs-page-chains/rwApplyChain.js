define([
  'vb/action/actionChain',
  'resources/js/usageRedwood',
], (ActionChain, rw) => {
  'use strict';

  // The Redwood look's table (your menu, Look): the requests the current look lists (shownRows: its search, chip and
  // sort, each with its breakdown), narrowed by the Redwood column filters (rwCols), as oj-table rows with their state
  // as Oracle's badges; and every filter's options with their counts, from all the requests with cost. Runs whenever
  // the list, the breakdown as it is worked out, or those filters change (the variables' onValueChanged), and after
  // Smart Search; the breakdown arrives three requests at a time, so a burst is taken in once it settles
  // (usageRedwood.latest). Sets only the Redwood look's own variables, and only what changed.
  const OPTIONS = [['rwNumbers', 'number'], ['rwProjects', 'project'], ['rwRentals', 'rental'], ['rwStatuses', 'status'], ['rwCosts', 'cost'],
    ['rwReady', 'ready'], ['rwPosted', 'posted'], ['rwTasks', 'task']];

  class rwApplyChain extends ActionChain {
    async run(context) {
      if (!(await rw.latest('costs'))) return;
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const shown = rw.pcByColumns(fns.shownRows(v.list, v.text, v.chip, v.breakdown, v.sortKey, v.sortDir), v.rwCols, fns);
      const rows = rw.pcRows(shown, fns, v.readOnly);
      if (!rw.same(v.rwRows, rows)) v.rwRows = rows;
      const keys = shown.map((r) => r.requestNumber);
      if (!rw.same(v.rwKeys, keys)) v.rwKeys = keys;
      const next = v.readOnly ? '' : fns.nextReady(v.list, v.breakdown);
      if (v.rwNext !== next) v.rwNext = next;
      const opts = rw.pcOptions(v.list, v.breakdown, fns);
      OPTIONS.forEach(([name, key]) => { if (!rw.same(v[name], opts[key])) v[name] = opts[key]; });
    }
  }

  return rwApplyChain;
});
