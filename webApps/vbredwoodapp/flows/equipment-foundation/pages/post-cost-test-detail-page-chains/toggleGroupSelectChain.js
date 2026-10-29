define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Select / clear every POSTABLE (past, not-yet-posted) week for ONE equipment
  // group. The group-row link carries id="grpsel-<groupKey>"; read the key off
  // event.target (walk up in case the click lands on an inner span).
  //
  // Toggle semantics mirror selectAllPastChain but scoped to the group:
  //   - if the group has any postable week NOT yet selected -> select them all
  //   - else (all already selected)                          -> clear them
  // Keeps per-row `selected` + selectedWeekKeys + visibility in sync exactly
  // like toggleWeekChain / selectAllPastChain do.
  class toggleGroupSelectChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      // read the groupKey off the checkbox id="grpsel-<key>". Match toggleWeekChain's
      // proven direct-read (event.target IS the input on a change event); fall back
      // to walking up the DOM in case the event target is a wrapper.
      let el = event && event.target;
      if (el && (!el.id || el.id.indexOf('grpsel-') !== 0)) {
        while (el && !(el.id && el.id.indexOf('grpsel-') === 0)) { el = el.parentElement; }
      }
      if (!el || !el.id || el.id.indexOf('grpsel-') !== 0) return;
      const groupKey = el.id.replace('grpsel-', '');

      const all0 = $page.variables.rowsAll || [];

      // this group's postable (past, unposted) weeks
      const groupPostable = all0.filter(function (r) {
        return r.kind === 'week' && r.groupKey === groupKey && r.postable && !r.posted;
      });
      if (groupPostable.length === 0) return; // nothing to select

      const allSelected = groupPostable.every(function (r) { return r.selected; });
      const nextSelected = !allSelected; // not all selected -> select; else clear

      let all = all0.map(function (r) {
        if (r.kind === 'week' && r.groupKey === groupKey && r.postable && !r.posted) {
          return Object.assign({}, r, { selected: nextSelected });
        }
        return r;
      });

      // refresh each group row's per-equipment selection state (drives the
      // group-row "Select all / Clear" link + label). Inline per this page's
      // chain style (each chain rebuilds its own state).
      all = all.map(function (r) {
        if (r.kind !== 'group') return r;
        const wk = all.filter(function (x) {
          return x.kind === 'week' && x.groupKey === r.groupKey && x.postable && !x.posted;
        });
        const hasP = wk.length > 0;
        return Object.assign({}, r, { hasPostable: hasP, allSelected: hasP && wk.every(function (x) { return x.selected; }) });
      });

      // rebuild the full selected-keys list from scratch across ALL groups so
      // other groups' selections are preserved.
      const sel = all.filter(function (r) { return r.kind === 'week' && r.selected; })
                     .map(function (r) { return r.rowKey; });

      // Shared filter — see selectAllPastChain for why the inline version went.
      $page.variables.rowsAll = all;
      $page.variables.rowsVisible = $page.functions.visibleRows(all);
      $page.variables.selectedWeekKeys = sel;
    }
  }

  return toggleGroupSelectChain;
});
