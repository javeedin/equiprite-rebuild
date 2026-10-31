define([
  'vb/action/actionChain',
  'resources/js/equipmentMaster',
], (ActionChain, em) => {
  'use strict';

  // What the list and the map show: the items (the rows, plus any only the server's search found), what the search
  // finds, the chips (each counting what it would show with the other filters as they are), the filters and the map's
  // location, sorted; the map's bubbles; the summary. Everything is worked out first and the view switched last, so
  // a view's template never meets the other view's rows.
  class applyChain extends ActionChain {
    async run(context, params) {
      const v = context.$page.variables;
      const target = (params && params.view) || v.view;
      const ref = { classesById: v.classesById, subclassesById: v.subclassesById, locationsById: v.locationsById };
      const server = v.server && v.server.q && v.server.q === em.serverQuery(v.text) ? v.server : null;
      const items = em.decorate(em.mergeRows(v.rows, server ? server.rows : []), ref);
      const found = em.search(items, v.text, server);
      const f = { classId: v.classId, subclassId: v.subclassId, status: v.status, tracking: v.tracking, source: v.source };
      const chips = em.chips(found, f, ref, v.allClasses);
      const filtered = em.filter(found, f, '');
      const map = em.mapPoints(filtered, v.locations);
      const shown = em.sort(v.location ? em.filter(filtered, {}, v.location) : filtered, v.sortKey, v.sortDir);
      if (target !== v.view) {
        v.shown = [];
        v.view = target;
      }
      v.itemCount = items.length;
      v.summary = em.summary(items, shown, { loading: v.isLoading, loaded: v.loadedCount, total: v.total });
      v.chips = chips;
      v.map = map;
      v.shown = shown;
    }
  }

  return applyChain;
});
