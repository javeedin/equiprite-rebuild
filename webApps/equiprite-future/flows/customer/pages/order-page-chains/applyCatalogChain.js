define([
  'vb/action/actionChain',
  'resources/js/customerOrder',
], (ActionChain, O) => {
  'use strict';

  // What the catalog shows: the rows for the class chip, "free on these dates only" and the search, each read for the
  // dates (availability, the rate as quoted, one unit for the window), at most catalogLimit of them. Worked out here
  // once rather than in the bindings, so typing in the search stays quick on a big catalog.
  class applyCatalogChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const rows = v.catalogRows || [];
      const chips = O.classChips(rows);
      const cls = chips.some((c) => c.key === v.catalogClass) ? v.catalogClass : 'all';
      const view = O.catalogView(rows, v.catalogText, cls, v.catalogAvail, v.catalogLimit, v.form, v.hideRates);
      v.catalogClass = cls;
      v.classChips = chips;
      v.catalogCount = view.count;
      v.catalogShown = view.shown;
    }
  }

  return applyCatalogChain;
});
