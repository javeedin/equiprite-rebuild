define([
  'vb/action/actionChain',
  'resources/js/usageRedwood',
], (ActionChain, rw) => {
  'use strict';

  // The Redwood look's table (your menu, Look): the requests on site the current look lists (queueShown: its search and
  // chip), narrowed by the Redwood column filters (rwCols), as oj-table rows, the one whose week is open below marked;
  // and every filter's options with their counts, from all the requests on site. Runs whenever the requests, the
  // search, the chip or the open request change (the variables' onValueChanged), and after Smart Search; a burst of
  // changes is taken in once it settles (usageRedwood.latest). Sets only the Redwood look's own variables, and only what
  // changed.
  const OPTIONS = [['rwNumbers', 'number'], ['rwProjects', 'project'], ['rwTasks', 'task'], ['rwEquipment', 'equipment'], ['rwWeeks', 'week'],
    ['rwHours', 'hours'], ['rwStatuses', 'status']];

  class rwApplyChain extends ActionChain {
    async run(context) {
      if (!(await rw.latest('timesheets'))) return;
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const shown = rw.tsByColumns(fns.queueShown(v.queue, v.queueText, v.queueKind), v.rwCols);
      const rows = rw.tsRows(shown, fns, v.requestNumber);
      if (!rw.same(v.rwRows, rows)) v.rwRows = rows;
      if (!rw.same(v.rwShown, shown)) v.rwShown = shown;
      const opts = rw.tsOptions(v.queue, fns);
      OPTIONS.forEach(([name, key]) => { if (!rw.same(v[name], opts[key])) v[name] = opts[key]; });
    }
  }

  return rwApplyChain;
});
