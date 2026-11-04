define([
  'vb/action/actionChain',
  'resources/js/equipmentMaster',
  'resources/js/equipmentRedwood',
], (ActionChain, em, rw) => {
  'use strict';

  // The Redwood view (Oracle's Smart Search page): the items applyChain worked out (shown), narrowed by the Redwood-only
  // column filters (rwCols), as rows of an oj-table; and every filter's options with their counts, from every item
  // (items: applyChain's, the server's search finds among them). The current look's list and map never see rwCols.
  const OPTIONS = [['rwItems', 'item'], ['rwClasses', 'cls'], ['rwSubclasses', 'sub'], ['rwTracking', 'tracking'], ['rwUnits', 'units'],
    ['rwLocations', 'location'], ['rwStatuses', 'status'], ['rwSources', 'source'], ['rwGroups', 'group']];

  class rwApplyChain extends ActionChain {
    async run(context, params) {
      const v = context.$page.variables;
      v.rwRows = rw.masterRows(rw.masterByColumns(v.shown, v.rwCols), context.$page.functions);
      const ref = { classesById: v.classesById, subclassesById: v.subclassesById, locationsById: v.locationsById };
      const opts = rw.masterOptions((params && params.items) || [], ref, v.assetGroupOptions, { status: em.statusLabel, source: em.sourceWords });
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      OPTIONS.forEach(([name, key]) => { if (!same(v[name], opts[key])) v[name] = opts[key]; });
    }
  }

  return rwApplyChain;
});
