define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /*
   * Open the miscellaneous-charge drawer for ONE equipment line.
   *
   * The clicked control carries its key in id="misc-<groupKey>" and is a SIBLING
   * of the group's expand target — a control nested inside another on-click
   * element never fires its own handler in this table (same rule the Days
   * drill-down and every checkbox here already follow).
   */
  class openMiscDrawerChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      let el = event && event.target;
      while (el && !(el.id && el.id.indexOf('misc-') === 0)) { el = el.parentElement; }
      if (!el) return;
      const groupKey = el.id.replace('misc-', '');

      const grp = ($page.variables.rowsAll || [])
        .find(function (r) { return r.kind === 'group' && r.groupKey === groupKey; });
      if (!grp) return;

      $page.variables.miscDrawerLine = {
        groupKey: groupKey,
        equipmentName: grp.label || 'Equipment',
        requestLineId: grp.requestLineId != null ? Number(grp.requestLineId) : null
      };

      // Default the expenditure item date to the line's LAST elapsed week end,
      // not today. A misc charge entered on Post Cost usually belongs to the
      // period being posted, and the old app's hardcoded `today` is exactly the
      // bug this port is meant to fix (see PORT_PLAN.md §2.4). Today is still
      // the right default for the ACCOUNTING date, which is set at post time.
      const weeks = ($page.variables.rowsAll || []).filter(function (r) {
        return r.kind === 'week' && r.groupKey === groupKey && r.postable && !r.posted;
      });
      const lastWeek = weeks.length ? weeks[weeks.length - 1] : null;
      const seed = (lastWeek && lastWeek.weekStartISO)
        ? lastWeek.weekStartISO
        : new Date().toISOString().slice(0, 10);

      $page.variables.miscDraft = {
        // Both defaults are the values PROVEN accepted by unprocessedProjectCosts
        // (201, $300 to OCEANEERING-DEMO). The value sets are restricted and there
        // is no org LOV on this pod, so defaulting to a known-good pair matters
        // more here than it would on a normal form.
        expenditureType: 'Equipment',
        expenditureOrg: 'Applications and Services',
        expItemDate: seed,
        quantity: 1,
        // Deliberately NULL, not 0. Every charge has an amount that must be typed,
        // and a pre-filled 0 has to be selected and deleted first on every single
        // one. Null renders the field empty; `required` still catches a blank, and
        // saveMiscChain's `> 0` test treats Number(null) === 0 as missing anyway.
        rawCost: null,
        currency: 'USD',
        comments: ''
      };
      $page.variables.miscFormError = '';
      $page.variables.isMiscDrawerOpen = true;

    }
  }

  return openMiscDrawerChain;
});
