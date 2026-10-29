define([
  'vb/action/actionChain',
  'resources/js/taskDataProvider',
  'resources/js/prPassThrough',
], (ActionChain, taskDataProvider, prPassThrough) => {
  'use strict';

  /*
   * Open the Project Split drawer for ONE WEEK.
   *
   * Week grain, not equipment: a split is authored per (request line x week), so
   * 27 Jul-2 Aug can post 60/40 while 3 Aug-9 Aug posts wholly to the request's
   * own project. That is what happens when equipment moves between jobs
   * mid-rental, and it is why the control lives on the week row.
   *
   * The control carries its key in id="splitwk-<rowKey>". That prefix cannot
   * false-match the post checkbox's "wk-": every guard on this row tests
   * indexOf(prefix) === 0, and "splitwk-" has "wk-" at index 6. Walk up from
   * event.target because the click can land on the inner icon or text span.
   *
   * A week belongs to exactly ONE request line, so the "a group is keyed by
   * equipment NAME and can span two lines" hazard that saveExpTypeChain has to
   * handle does not arise here at all.
   */
  class openSplitDrawerChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      let el = event && event.target;
      while (el && !(el.id && el.id.indexOf('splitwk-') === 0)) { el = el.parentElement; }
      if (!el) return;
      const rowKey = el.id.replace('splitwk-', '');

      const rows = $page.variables.rowsAll || [];
      const wk = rows.find(function (r) { return r.kind === 'week' && r.rowKey === rowKey; });
      if (!wk) return;

      // Two reasons a week cannot be re-projected, both decided by one shared
      // predicate so this drawer and the row's badge can never disagree:
      //
      //  - already POSTED or REVERSED: settled. The ledger froze its projects at
      //    post time. Read-only rather than hidden -- the user still needs to SEE
      //    where it went, and "the control vanished" is not an explanation.
      //
      //  - a PR pass-through row, BASE *or* MARGIN: the project belongs to the
      //    Fusion PO's distribution. Note this is deliberately wider than the
      //    expenditure-type lock, which covers base rows only. A margin row's
      //    TYPE is ours to author; its PROJECT is not, because splitting a markup
      //    away from the order it marks up would move a tenth of the money and
      //    leave the base whole. See prPassThrough.isSplitLocked.
      const locked = prPassThrough.isSplitLocked(wk);
      const lockReason = prPassThrough.splitLockReason(wk);

      $page.variables.splitDrawerLine = {
        groupKey: wk.groupKey,
        rowKey: rowKey,
        equipmentName: wk.equipmentName || (function () {
          const g = rows.find(function (r) { return r.kind === 'group' && r.groupKey === wk.groupKey; });
          return (g && g.label) || 'Equipment';
        })(),
        weekLabel: wk.label || '',
        weekStartISO: wk.weekStartISO || '',
        weekCost: Number(wk.cost || 0),
        requestLineId: wk.requestLineId != null ? Number(wk.requestLineId) : null,
        locked: locked,
        lockReason: lockReason,
        splitCount: Array.isArray(wk.splits) ? wk.splits.length : 0
      };

      // DEEP COPY. splitSlices is two-way bound by the editor, so handing over
      // the row's own array would let a cancelled edit leak into rowsAll -- the
      // table would show a split that was never saved.
      const existing = Array.isArray(wk.splits) ? wk.splits : [];
      let slices = existing.map(function (s) {
        return {
          projectRefId:  s.projectRefId  != null ? Number(s.projectRefId) : null,
          projectNumber: s.projectNumber || '',
          projectName:   s.projectName   || '',
          taskId:        s.taskId        != null ? Number(s.taskId) : null,
          taskNumber:    s.taskNumber    || '',
          taskName:      s.taskName      || '',
          pct:           s.splitPct != null ? Number(s.splitPct)
                       : (s.pct != null ? Number(s.pct) : null)
        };
      });

      // Nothing authored yet: seed the request's OWN project as the first slice,
      // at no percentage. The common ask is "move 40% of this week off my
      // project", so starting from the truth already on screen means one row to
      // add rather than two, and it makes the 100% concrete.
      //
      // The ids here are real, not zeros: the post-cost list endpoint returns all
      // four ppm* fields and the chain reads the raw body, so nothing is stripped
      // (checked live -- ppmProjectRefId 300000336994396 / ppmTaskRefId
      // 100002535881340 on REQ-1786556804640).
      if (!slices.length && !locked && $page.variables.ppmProjectNumber) {
        slices = [{
          projectRefId:  Number($page.variables.ppmProjectRefId) || null,
          projectNumber: String($page.variables.ppmProjectNumber),
          projectName:   $page.variables.projectName || '',
          taskId:        Number($page.variables.ppmTaskRefId) || null,
          taskNumber:    $page.variables.ppmTaskNumber ? String($page.variables.ppmTaskNumber) : '',
          taskName:      $page.variables.taskName || '',
          pct:           null
        }];
      }
      $page.variables.splitSlices = slices;

      // Reset the add-a-slice sub-form so the previous week's pick cannot be
      // added to this one.
      $page.variables.splitPickProjectId     = null;
      $page.variables.splitPickProjectName   = '';
      $page.variables.splitPickProjectNumber = '';
      $page.variables.splitPickTaskId        = null;
      $page.variables.splitPickTaskName      = '';
      $page.variables.splitPickTaskNumber    = '';
      $page.variables.splitPickPct           = null;
      $page.variables.splitTaskError         = '';
      $page.variables.splitFormError         = '';

      // Resolved-empty, not pending: no fetch is in flight, so the task dropdown
      // should say "pick a project first" at once instead of skeletoning forever.
      $page.variables.splitTasksDp       = taskDataProvider.emptyTaskDataProvider();
      $page.variables.splitTaskTree      = {};
      $page.variables.splitTasksCacheKey = '';

      $page.variables.isSplitDrawerOpen = true;
    }
  }

  return openSplitDrawerChain;
});
