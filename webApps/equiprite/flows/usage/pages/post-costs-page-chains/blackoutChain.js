define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Mark or clear a blackout day (a day the equipment was down and must not be billed): the old toggleBlackoutChain.
  // POST createLineDayException {requestLineId, exceptionDate, rateType BLACKOUT | USAGE, reason}, an upsert on line +
  // date, so clearing writes USAGE rather than deleting. A posted week is frozen in the ledger and refuses: it is
  // corrected by reverse and re-post. The day, week, equipment and header figures move at once (the arithmetic the
  // engine already did server-side; the next read replaces them).
  class blackoutChain extends ActionChain {
    async run(context, { key }) {
      const { $page } = context;
      const v = $page.variables;
      const rows = v.rowsAll || [];
      const day = rows.find((r) => r.kind === 'day' && r.rowKey === key);
      if (!day) return;
      const redraw = () => { v.rowsAll = rows.map((r) => (r === day ? Object.assign({}, r) : r)); };
      if (day.locked || v.readOnly || v.isPosting) {
        redraw();
        await Actions.fireNotificationEvent(context, {
          summary: 'Week already posted',
          message: 'This week has been posted, so its cost is frozen in the ledger. Reverse the week first, then re-post it at the corrected amount.',
          type: 'warning',
          displayMode: 'transient',
        });
        return;
      }
      const wanted = day.blackout ? 'USAGE' : 'BLACKOUT';
      let resp;
      try {
        resp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/createLineDayException',
          body: { requestLineId: day.requestLineId, exceptionDate: day.dayISO, rateType: wanted, reason: wanted === 'BLACKOUT' ? 'Excluded from post cost' : null },
        });
      } catch (e) {
        console.error('[blackoutChain] REST error', e);
      }
      if (!resp || !resp.ok) {
        redraw();
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not update',
          message: 'The day could not be updated' + (resp && resp.status ? ' (status ' + resp.status + ')' : '') + '.',
          type: 'error',
          displayMode: 'transient',
        });
        return;
      }
      const nowBlackout = wanted === 'BLACKOUT';
      const delta = nowBlackout ? -Number(day.dayCost || 0) : Number(day.restoreCost || day.dayCost || 0);
      const round2 = (n) => Math.round(n * 100) / 100;
      v.rowsAll = rows.map((r) => {
        if (r === day) {
          return Object.assign({}, r, {
            blackout: nowBlackout,
            restoreCost: nowBlackout ? Number(day.dayCost || 0) : Number(day.restoreCost || day.dayCost || 0),
            dayCost: nowBlackout ? 0 : Number(day.restoreCost || day.dayCost || 0),
          });
        }
        if (r.kind === 'week' && r.rowKey === day.weekKey) {
          return Object.assign({}, r, {
            cost: Math.max(round2(Number(r.cost || 0) + delta), 0),
            days: Math.max(Number(r.days || 0) + (nowBlackout ? -1 : 1), 0),
            blackoutDays: Math.max(Number(r.blackoutDays || 0) + (nowBlackout ? 1 : -1), 0),
          });
        }
        if (r.kind === 'group' && r.groupKey === day.groupKey) {
          return Object.assign({}, r, {
            cost: Math.max(round2(Number(r.cost || 0) + delta), 0),
            days: Math.max(Number(r.days || 0) + (nowBlackout ? -1 : 1), 0),
          });
        }
        return r;
      });
      const facts = Object.assign({}, v.facts || {});
      facts.totalCost = Math.max(round2(Number(facts.totalCost || 0) + delta), 0);
      facts.incurredToDate = Math.max(round2(Number(facts.incurredToDate || 0) + delta), 0);
      v.facts = facts;
      await Actions.fireNotificationEvent(context, {
        summary: nowBlackout ? 'Blackout day marked' : 'Blackout day cleared',
        message: day.label + (nowBlackout ? ' is excluded — it will not be billed.' : ' will be billed again.'),
        type: 'confirmation',
        displayMode: 'transient',
      });
    }
  }

  return blackoutChain;
});
