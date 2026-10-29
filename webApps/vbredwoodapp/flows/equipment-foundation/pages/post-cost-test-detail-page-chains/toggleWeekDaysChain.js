define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /**
   * Expand / collapse the day rows under one week — the third drill level
   * (equipment → week → day), where blackout days are marked.
   *
   * Mirrors toggleGroupChain exactly: the clicked element carries its key in
   * id="wkexp-<rowKey>", and we walk up from event.target because the click may
   * land on an inner span.
   */
  class toggleWeekDaysChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      // The week row also carries the post-selection checkbox (id "wk-...") and,
      // on some rows, other controls. Bail out if the click came from one of those
      // so selecting a week for posting does not also expand it.
      let src = event && event.target;
      while (src) {
        if (src.id && src.id.indexOf('wk-') === 0) { return; }
        if (src.id && src.id.indexOf('bo-') === 0) { return; }
        if (src.id && src.id.indexOf('wkexp-') === 0) { break; }
        src = src.parentElement;
      }

      let el = event && event.target;
      while (el && !(el.id && el.id.indexOf('wkexp-') === 0)) { el = el.parentElement; }
      if (!el) return;
      const weekKey = el.id.replace('wkexp-', '');

      const all = ($page.variables.rowsAll || []).map(function (r) {
        if (r.kind === 'week' && r.rowKey === weekKey) {
          return Object.assign({}, r, { weekExpanded: !r.weekExpanded });
        }
        return r;
      });

      $page.variables.rowsAll = all;
      // Use the SHARED filter, not a local copy — this chain carried its own
      // inlined version, the exact drift visibleRows() was extracted to stop.
      $page.variables.rowsVisible = $page.functions.visibleRows(all);
    }
  }

  return toggleWeekDaysChain;
});
