define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/timesheetRows',
  'resources/js/expenditureTypes'
], (ActionChain, Actions,
  timesheetRows, expenditureTypes) => {
  'use strict';

  class refreshGridByWeekChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const requestNumber = $page.variables.requestId;
      const weekStart     = $page.variables.selectedWeekStart;

      if (!weekStart) return;

      const response = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getEquipriteV1ViewsTimesheetDetailsByWeek',
        uriParams: {
          weekStartDate: weekStart,
          requestNumber: requestNumber || 'ALL'
        }
      });

      if (!response || !response.ok) {
        console.warn('[refreshGridByWeekChain] Failed to fetch timesheet details for week:', weekStart);
        return;
      }

      let rows = response.body.data || [];

      // requestNumber is now a path param — backend filters server-side

      // Non-rentable lines (consumables/materials) don't track hours — their cost
      // posts directly (qty × rate) and must never appear as a timesheet row.
      // Exclude ONLY confirmed non-rentables ('N'); keep everything else, incl.
      // rentable lines that have no time entry yet (freshly deployed) — those are
      // synthesized by the backend and may not carry the flag, so `=== 'Y'` would
      // wrongly drop them and the grid would flash-then-empty.
      rows = rows.filter(r => r.isRentable !== 'N');

      const lines = timesheetRows.toGridRows(rows);

      // Narrow each row's Expenditure Type picker to the types AUTHORED for that
      // equipment (EQR_EXP_TYPE_MAP), instead of the project's whole list.
      //
      // Fire-and-forget, like the list itself: the grid must not wait on it. The
      // pickers show the full list until this lands and narrow when it does, and
      // a failure leaves them unnarrowed rather than empty.
      expenditureTypes.loadMapsForMasters(
        function (opts) { return Actions.callRest(context, opts); },
        lines.map(function (l) { return l.equipment_master_id; })
      ).then(function (map) {
        // Reassign whole -- VBCS tracks the object by reference, so adding keys
        // in place would not re-render the pickers.
        if (map && Object.keys(map).length) { $page.variables.expTypeMap = map; }

        // NO unmatched-mapping warning here, unlike vbEnterChain. Deliberate:
        // the rows are the same request's lines whichever week you page to, so
        // the warning would be identical every time and would fire on every
        // click through the weeks. Once per page load is enough to be told;
        // more than that is noise people learn to dismiss.
      }).catch(function (e) {
        console.warn('[EXPTYPE] mapping refresh failed:', e && e.message);
      });

      // Header shows the RENTAL SPAN, not the week -- the week is already in the
      // week picker beside it. Set wherever the grid is (re)built so it survives
      // a week change.
      const spanLabel = $page.functions.formatRequestSpan(lines);
      // Only overwrite when we actually derived one. The span belongs to the
      // REQUEST, so it must not blank out just because the week the user paged
      // to happens to carry no rows.
      if (spanLabel) { $page.variables.requestSpanLabel = spanLabel; }
      const provider = $page.functions.initProviderFromLines(lines, weekStart);
      $page.variables.dataGridProvider = provider;

      if (rows.length > 0) {
        const allPosted    = rows.every(r => r.entryStatus === 'POSTED');
        const allApproved  = rows.every(r => r.entryStatus === 'APPROVED' || r.entryStatus === 'POSTED');
        const allSubmitted = rows.every(r => r.entryStatus === 'SUBMITTED' || r.entryStatus === 'APPROVED' || r.entryStatus === 'POSTED');
        const derivedStatus = allPosted ? 'POSTED' : allApproved ? 'APPROVED' : allSubmitted ? 'SUBMITTED' : 'DRAFT';
        $page.variables.headerStatus = derivedStatus;
        $page.variables.totalHours   = rows.reduce((s, r) => s + (r.totalHours || 0), 0);
        $page.variables.billAmount   = rows.reduce((s, r) => s + (r.totalBill   || 0), 0);
      } else {
        $page.variables.headerStatus = 'DRAFT';
        $page.variables.totalHours   = 0;
        $page.variables.billAmount   = 0;
        const emptyProvider = $page.functions.initProviderFromLines([], weekStart);
        $page.variables.dataGridProvider = emptyProvider;
      }
    }
  }

  return refreshGridByWeekChain;
});
