define([
  'vb/action/actionChain',
  'resources/js/approvalQueue',
  'resources/js/rules',
], (ActionChain, queue, rules) => {
  'use strict';

  // The queue from the requests: what waits on the Equipment Manager, most urgent first; then the chip, the source
  // and the search. A ticked request no longer to decide, or hidden by the search, drops out of the selection.
  // The Redwood look (your menu) shows the same queue as an oj-table: its rows are worked out here from the same shown
  // queue, then its column filters (Smart Search; rwFilterChain) are applied to its rows only (the current look does not
  // show them), with every column filter's options and their counts.
  class applyChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      const app = $application.variables;
      const now = Date.now();
      const items = queue.build(v.rows, v.linesByRequest, {
        now,
        quoting: (source) => rules.isQuotingAllowed(app.globalSettings, app.flagsLoaded, source),
        settled: v.settled,
      });
      const shown = queue.filter(items, v.text, v.stage, v.source);
      const ticked = (v.selectedIds || []).filter((id) => items.some((i) => i.key === String(id) && i.kind === 'decide'));
      const chips = queue.chips(items);
      v.items = items;
      v.chips = chips;
      v.summary = queue.summary(items);
      v.selectedIds = ticked;
      v.selection = queue.selection(shown, ticked);
      v.shown = shown;
      // The open request keeps its place; its queue entry is refreshed (it may have moved on, or left the queue).
      if (v.current && v.current.key) {
        const at = items.filter((i) => i.key === v.current.key)[0];
        if (at) v.current = at;
      }
      // The Redwood look: its rows (ticked and tickable as the current look's tick boxes), and each filter's options.
      // Each is set only when it changed: a new array makes the oj-table fetch again (and abort a fetch under way).
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const rwShown = queue.byColumns(shown, v.rwCols, now);
      v.rwShown = rwShown;
      const rwRows = queue.redwoodRows(rwShown).map((r) => Object.assign(r, {
        ticked: ticked.indexOf(r.key) !== -1,
        tickable: r.kind === 'decide' && !!v.canAct,
      }));
      if (!same(v.rwRows, rwRows)) v.rwRows = rwRows;
      const needs = [{ value: 'all', label: 'All (' + items.length + ')' }]
        .concat(chips.filter((c) => c.key !== 'all').map((c) => ({ value: c.key, label: c.label + ' (' + c.count + ')' })));
      if (!same(v.rwNeeds, needs)) v.rwNeeds = needs;
      const opts = queue.columnOptions(items, now);
      [['rwNumbers', 'number'], ['rwParties', 'party'], ['rwEquipment', 'equipment'], ['rwDates', 'dates'], ['rwTypes', 'type'],
        ['rwRequesters', 'requester']].forEach(([name, key]) => {
        if (!same(v[name], opts[key])) v[name] = opts[key];
      });
    }
  }

  return applyChain;
});
