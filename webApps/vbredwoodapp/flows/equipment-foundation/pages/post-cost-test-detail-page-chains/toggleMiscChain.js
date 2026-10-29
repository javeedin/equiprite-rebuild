define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /*
   * Select / deselect one misc charge for posting. Control carries its key in
   * id="mscsel-<rowKey>", same checkbox + stopEvent + on-change pattern as the
   * week rows.
   *
   * Kept OUT of selectedWeekKeys deliberately: a week posts through the OIC
   * flow, a misc charge posts through the Fusion unprocessedProjectCosts call.
   * Same button, two mechanisms, and a failure in one must not report success
   * for the other — so they are counted separately (PORT_PLAN.md §3).
   */
  class toggleMiscChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      let el = event && event.target;
      while (el && !(el.id && el.id.indexOf('mscsel-') === 0)) { el = el.parentElement; }
      if (!el) return;
      const rowKey = el.id.replace('mscsel-', '');

      const all = ($page.variables.rowsAll || []).map(function (r) {
        if (r.kind === 'misc' && r.rowKey === rowKey && r.status !== 'POSTED') {
          return Object.assign({}, r, { selected: !r.selected });
        }
        return r;
      });

      $page.variables.rowsAll     = all;
      $page.variables.rowsVisible = $page.functions.visibleRows(all);
    }
  }

  return toggleMiscChain;
});
