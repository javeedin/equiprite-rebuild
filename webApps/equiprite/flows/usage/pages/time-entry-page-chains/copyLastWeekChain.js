define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Copy last week (FDD 7.13, S20). Reads the previous week through the grid's own call (views/timesheet-details) and
  // copies each line's hours and rate type into this week's boxes, only on days inside the line's dates and only on
  // rows that can still be edited. Nothing is written: the copy is ordinary typing, saved by Save.
  class copyLastWeekChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      if (!v.requestNumber || !v.weekStart || v.isSaving) return;
      const prevWeek = $page.functions.shiftWeek(v.weekStart, -1);
      let rows = null;
      try {
        const res = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsTimesheetDetailsByWeek',
          uriParams: { weekStartDate: prevWeek, requestNumber: v.requestNumber },
        });
        rows = res && res.ok && res.body && Array.isArray(res.body.data) ? res.body.data : null;
      } catch (e) {
        console.warn('[copyLastWeekChain] failed', e);
      }
      if (!rows) {
        v.saveError = 'Last week could not be read, so nothing was copied.';
        return;
      }
      const out = $page.functions.copyFrom(rows.filter((r) => r && r.eqrTimeEntryId), v.rows, v.edits, v.weekStart);
      if (!out.copied) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Nothing to copy',
          message: 'Last week (' + $page.functions.weekLabel(prevWeek) + ') has no saved hours on these lines.',
          type: 'info',
          displayMode: 'transient',
        });
        return;
      }
      v.edits = out.edits;
      // Fresh row objects redraw the boxes with the copied values (a typed box ignores its value binding).
      v.rows = $page.functions.freshRows(v.rows);
      await Actions.fireNotificationEvent(context, {
        summary: 'Last week copied',
        message: out.copied + (out.copied === 1 ? ' row' : ' rows') + ' filled from ' + $page.functions.weekLabel(prevWeek)
          + '. Check the days, then Save.',
        type: 'confirmation',
        displayMode: 'transient',
      });
    }
  }

  return copyLastWeekChain;
});
