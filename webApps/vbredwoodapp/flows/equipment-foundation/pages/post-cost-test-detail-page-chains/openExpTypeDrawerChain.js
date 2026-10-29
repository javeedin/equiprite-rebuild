define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  /*
   * Open the Expenditure Type drawer for ONE equipment.
   *
   * The clicked control carries its key in id="exptype-<groupKey>" and lives in
   * its OWN cell, so unlike the label-cell controls it has nothing to be nested
   * inside. It still walks up from event.target because the click can land on
   * the inner text span or the pencil icon rather than the span that owns the id.
   */
  class openExpTypeDrawerChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      let el = event && event.target;
      while (el && !(el.id && el.id.indexOf('exptype-') === 0)) { el = el.parentElement; }
      if (!el) return;
      const groupKey = el.id.replace('exptype-', '');

      const rows = $page.variables.rowsAll || [];
      const grp = rows.find(function (r) { return r.kind === 'group' && r.groupKey === groupKey; });
      if (!grp) return;

      // Whether any week of this equipment is already posted. Drives the drawer's
      // warning: a posted week keeps the type it was posted with, so changing the
      // line here only affects weeks not yet sent. Saying that up front is cheaper
      // than explaining an unchanged PPM line afterwards.
      const hasPosted = rows.some(function (r) {
        return r.kind === 'week' && r.groupKey === groupKey && r.posted;
      });

      $page.variables.expTypeDrawerLine = {
        groupKey: groupKey,
        equipmentName: grp.label || 'Equipment',
        requestLineId: grp.requestLineId != null ? Number(grp.requestLineId) : null,
        current: grp.expenditureType || '',
        hasPosted: hasPosted
      };

      // Seed from what the line already has. Deliberately NOT defaulted to
      // 'Equipment' when unset: the drawer states that Equipment is the fallback
      // in its notice, and pre-selecting it would turn "nobody chose" into a
      // choice the moment someone opens the drawer to look.
      //
      // null, not '': oj-select-single reads null as "nothing selected", whereas
      // '' is a key it would try and fail to resolve. The variable is typed 'any'
      // so the null survives -- writing it into a 'string'-typed sub-property of a
      // structured variable is what broke the two-way bind the first time round.
      $page.variables.expTypeChoice = grp.expenditureType || null;
      $page.variables.expTypeFormError = '';
      $page.variables.isExpTypeDrawerOpen = true;

    }
  }

  return openExpTypeDrawerChain;
});
