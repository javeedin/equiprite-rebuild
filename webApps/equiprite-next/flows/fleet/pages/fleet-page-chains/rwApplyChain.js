define([
  'vb/action/actionChain',
  'resources/js/equipmentBoard',
  'resources/js/equipmentRedwood',
], (ActionChain, board, rw) => {
  'use strict';

  // The Redwood view (Oracle's Smart Search page): the units applyChain worked out (shown), narrowed by the Redwood-only
  // column filters (rwCols), as rows of an oj-table; and every filter's options with their counts, from every unit.
  // The current look's list and board never see rwCols.
  const OPTIONS = [['rwUnits', 'unit'], ['rwNames', 'name'], ['rwClasses', 'cls'], ['rwStatuses', 'status'], ['rwRequests', 'request'],
    ['rwParties', 'party'], ['rwNext', 'next'], ['rwYards', 'yard']];

  class rwApplyChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.rwRows = rw.fleetRows(rw.fleetByColumns(v.shown, v.rwCols), context.$page.functions);
      const opts = rw.fleetOptions(v.units, board.LANES);
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      OPTIONS.forEach(([name, key]) => { if (!same(v[name], opts[key])) v[name] = opts[key]; });
    }
  }

  return rwApplyChain;
});
