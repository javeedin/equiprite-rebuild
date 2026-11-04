define([
  'vb/action/actionChain',
  'resources/js/usageRedwood',
], (ActionChain, rw) => {
  'use strict';

  // The Redwood look's table (your menu, Look): the lines the current look lists (shown: its week, status, search and
  // "needs a look only"), narrowed by the Redwood column filters (rwCols), as oj-table rows with what needs a look as
  // Oracle's badges; and every filter's options with their counts, from the week's lines (Week: every week). Runs
  // whenever the lines or those filters change (the variables' onValueChanged), and after Smart Search; a burst of
  // changes is taken in once it settles (usageRedwood.latest). The ticks are not in the rows (the table reads them from
  // picked), so ticking never redraws the table. Sets only the Redwood look's own variables, and only what changed.
  const OPTIONS = [['rwNumbers', 'number'], ['rwProjects', 'project'], ['rwTypes', 'type'], ['rwHours', 'hours'], ['rwChanges', 'change'],
    ['rwStatuses', 'status'], ['rwWeeks', 'week'], ['rwEquipment', 'equipment'], ['rwSubmitters', 'submitter']];

  class rwApplyChain extends ActionChain {
    async run(context) {
      if (!(await rw.latest('approve-time'))) return;
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const shown = rw.taByColumns(fns.shown(v.rowsAll, v.weekKey, v.statusKey, v.searchText, v.onlyLook, v.weekDays), v.rowsAll, v.weekDays, v.rwCols, fns);
      const rows = rw.taRows(shown, v.rowsAll, v.weekDays, v.auditByEntry, fns, v.readOnly);
      if (!rw.same(v.rwRows, rows)) v.rwRows = rows;
      const keys = shown.map((r) => r.key);
      if (!rw.same(v.rwKeys, keys)) v.rwKeys = keys;
      const opts = rw.taOptions(v.rowsAll, v.weekKey, v.weekDays, fns);
      OPTIONS.forEach(([name, key]) => { if (!rw.same(v[name], opts[key])) v[name] = opts[key]; });
    }
  }

  return rwApplyChain;
});
