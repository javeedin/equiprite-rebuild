define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Expand / collapse one equipment group. The clicked group row carries its
  // key in id="grp-<groupKey>"; read it off event.target (walk up to the
  // element that has the id, since the click may land on an inner span).
  class toggleGroupChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      // ignore clicks that originated on the per-equipment "select all weeks"
      // link (id starts grpsel-): that has its own chain and must NOT also
      // expand/collapse the group. Walk up from the click target looking for it.
      let src = event && event.target;
      while (src) {
        if (src.id && src.id.indexOf('grpsel-') === 0) { return; }
        if (src.id && src.id.indexOf('grp-') === 0) { break; } // reached the group row itself
        src = src.parentElement;
      }

      let el = event && event.target;
      while (el && !(el.id && el.id.indexOf('grp-') === 0)) { el = el.parentElement; }
      if (!el) return;
      const groupKey = el.id.replace('grp-', '');

      let all = ($page.variables.rowsAll || []).map(function (r) {
        if (r.kind === 'group' && r.groupKey === groupKey) {
          return Object.assign({}, r, { expanded: !r.expanded });
        }
        return r;
      });

      // keep each group row's per-equipment selection state + cost rollup fresh
      // (drives the "Select all / Clear" link and the group total) after any
      // rebuild. Shared with every other chain — see the page module.
      all = $page.functions.restampGroups(all);

      $page.variables.rowsAll = all;
      $page.variables.rowsVisible = $page.functions.visibleRows(all);
    }
  }

  return toggleGroupChain;
});
