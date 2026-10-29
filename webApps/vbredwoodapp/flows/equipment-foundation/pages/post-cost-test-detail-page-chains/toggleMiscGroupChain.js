define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /**
   * Expand / collapse the miscellaneous charges under one equipment — the second
   * drill level alongside the weeks (equipment → [weeks → days] + [misc charges]).
   *
   * Mirrors toggleWeekDaysChain: the clicked element carries its key in
   * id="miscgrp-<rowKey>", and we walk up from event.target because the click may
   * land on an inner span (the chevron or the label).
   */
  class toggleMiscGroupChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      let el = event && event.target;
      while (el && !(el.id && el.id.indexOf('miscgrp-') === 0)) { el = el.parentElement; }
      if (!el) return;
      const key = el.id.replace('miscgrp-', '');

      const all = ($page.variables.rowsAll || []).map(function (r) {
        if (r.kind === 'miscGroup' && r.rowKey === key) {
          return Object.assign({}, r, { miscExpanded: !r.miscExpanded });
        }
        return r;
      });

      $page.variables.rowsAll     = all;
      $page.variables.rowsVisible = $page.functions.visibleRows(all);
    }
  }

  return toggleMiscGroupChain;
});
