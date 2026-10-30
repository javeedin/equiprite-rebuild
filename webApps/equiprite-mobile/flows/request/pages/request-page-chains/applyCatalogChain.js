define([
  'vb/action/actionChain',
  'resources/js/orderForm',
], (ActionChain, order) => {
  'use strict';

  // What the catalog list shows: the rows for the class chip, "free on these dates only" and the search, each read
  // for the dates (availability, the rate as quoted, one unit for the window), at most catalogLimit of them. Worked
  // out here once rather than in the bindings, so typing in the search stays quick on a big catalog.
  class applyCatalogChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const rows = v.catalogRows || [];
      const chips = order.classChips(rows);
      const cls = chips.some((c) => c.key === v.catalogClass) ? v.catalogClass : 'all';
      const hits = order.filterCatalog(rows, v.catalogText, cls, v.catalogAvail);
      const form = v.form || {};
      v.catalogClass = cls;
      v.classChips = chips;
      v.catalogCount = hits.length;
      v.catalogShown = order.catalogView(hits.slice(0, v.catalogLimit), form.startDate, form.endDate, v.hideRates);
    }
  }

  return applyCatalogChain;
});
