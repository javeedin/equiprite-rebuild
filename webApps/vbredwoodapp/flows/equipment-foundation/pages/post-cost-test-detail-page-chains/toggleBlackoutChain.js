define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Mark or clear a blackout day from the post-cost day drill-down.
   *
   * Writes EQR_LINE_DAY_EXCEPTION keyed on (request line, date). Deliberately not a
   * timesheet record: this is the TIMESHEETS-OFF configuration, where the timesheet
   * pages are not part of the flow at all. (With timesheets ON the timesheet itself
   * records which days were not used, so blackout does not apply.)
   *
   * The engine and both post-cost views already subtract these days, so the week and
   * request totals move on the next read. Nothing here computes money.
   *
   * Clearing writes rateType USAGE rather than deleting: the endpoint upserts on
   * (line, date), so this is idempotent and needs no row id.
   */
  class toggleBlackoutChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      let el = event && event.target;
      while (el && !(el.id && el.id.indexOf('bo-') === 0)) { el = el.parentElement; }
      if (!el) return;

      // id shape: bo-<rowKey>  — rowKey is unique per day row
      const rowKey = el.id.replace('bo-', '');
      const rows = $page.variables.rowsAll || [];
      const day = rows.find(function (r) { return r.kind === 'day' && r.rowKey === rowKey; });
      if (!day) return;

      if (day.locked) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Week already posted',
          message: 'This week has been posted, so its cost is frozen in the ledger. ' +
                   'Reverse the week first, then re-post it at the corrected amount.',
          type: 'warning',
          displayMode: 'transient'
        });
        // Put the checkbox back — the model did not change.
        if (el.checked !== undefined) el.checked = !!day.blackout;
        return;
      }

      const wanted = day.blackout ? 'USAGE' : 'BLACKOUT';

      try {
        const resp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/createLineDayException',
          body: {
            requestLineId: day.requestLineId,
            exceptionDate: day.dayISO,
            rateType:      wanted,
            reason:        wanted === 'BLACKOUT' ? 'Excluded from post cost' : null
          }
        });

        // 201 on insert, 200 on the upsert-found branch. Both are success.
        if (!resp || !resp.ok) {
          if (el.checked !== undefined) el.checked = !!day.blackout;
          await Actions.fireNotificationEvent(context, {
            summary: 'Could not update',
            message: 'The day could not be updated (status ' + (resp && resp.status) + ').',
            type: 'error',
            displayMode: 'transient'
          });
          return;
        }
      } catch (e) {
        if (el.checked !== undefined) el.checked = !!day.blackout;
        console.error('[toggleBlackoutChain] REST error', e);
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not update',
          message: 'The day could not be updated. See console.',
          type: 'error',
          displayMode: 'transient'
        });
        return;
      }

      const nowBlackout = (wanted === 'BLACKOUT');

      // The day's own contribution, which is what leaves (or returns to) the bill.
      // Held before the row is rewritten, since excluding zeroes dayCost.
      const delta = nowBlackout ? -Number(day.dayCost || 0) : Number(day.restoreCost || day.dayCost || 0);

      // Roll the change up immediately: day → week → equipment → header. Without
      // this the day reads $0 EXCLUDED while its week still shows the full cost and
      // day count, which looks like the exclusion silently failed. The arithmetic
      // mirrors what the engine and views already did server-side (a week is
      // cost × days_in_week ÷ span_days, so one day is exactly dayCost); the next
      // page load replaces these figures with the server's own.
      const all = rows.map(function (r) {
        if (r.kind === 'day' && r.rowKey === rowKey) {
          return Object.assign({}, r, {
            blackout: nowBlackout,
            // Remember what it was worth so restoring puts back the right amount.
            restoreCost: nowBlackout ? Number(day.dayCost || 0) : Number(day.restoreCost || day.dayCost || 0),
            dayCost: nowBlackout ? 0 : Number(day.restoreCost || day.dayCost || 0)
          });
        }
        if (r.kind === 'week' && r.rowKey === day.weekKey) {
          return Object.assign({}, r, {
            cost: Math.max(Math.round((Number(r.cost || 0) + delta) * 100) / 100, 0),
            days: Math.max(Number(r.days || 0) + (nowBlackout ? -1 : 1), 0),
            blackoutDays: Math.max(Number(r.blackoutDays || 0) + (nowBlackout ? 1 : -1), 0)
          });
        }
        if (r.kind === 'group' && r.groupKey === day.groupKey) {
          return Object.assign({}, r, {
            cost: Math.max(Math.round((Number(r.cost || 0) + delta) * 100) / 100, 0),
            days: Math.max(Number(r.days || 0) + (nowBlackout ? -1 : 1), 0)
          });
        }
        return r;
      });

      const round2 = function (n) { return Math.round(n * 100) / 100; };
      $page.variables.totalCost = Math.max(round2(Number($page.variables.totalCost || 0) + delta), 0);
      // A day can only be excluded on an unposted week, so the change always lands
      // in "incurred", never in "already posted".
      $page.variables.incurredToDate = Math.max(round2(Number($page.variables.incurredToDate || 0) + delta), 0);

      $page.variables.rowsAll = all;
      // Use the SHARED filter, not a local copy. This chain carried its own
      // inlined version, which is the exact drift visibleRows() was extracted to
      // stop — it predates the misc sub-group and would have made charges vanish
      // whenever a day was marked.
      $page.variables.rowsVisible = $page.functions.visibleRows(all);

      await Actions.fireNotificationEvent(context, {
        // Says "blackout" in as many words: the toast is the one place that can
        // name the concept without crowding the row, and the page is otherwise
        // full of controls that SELECT weeks rather than exclude days.
        summary: nowBlackout ? 'Blackout day marked' : 'Blackout day cleared',
        message: day.label + (nowBlackout ? ' is excluded — it will not be billed.' : ' will be billed again.'),
        type: 'confirmation',
        displayMode: 'transient'
      });
    }
  }

  return toggleBlackoutChain;
});
