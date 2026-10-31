define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/costPosting',
  'resources/js/shellBus',
], (ActionChain, Actions, costPosting, bus) => {
  'use strict';

  // Exclude a day (the equipment was down and must not be billed), or bill it again: New's Post costs blackoutChain.
  // POST createLineDayException { requestLineId, exceptionDate, rateType BLACKOUT | USAGE, reason }, an upsert on
  // line + date, so billing it again writes USAGE rather than deleting. A posted week is frozen in the ledger and
  // refuses: it is corrected by reverse and re-post. The day, week and equipment figures move at once (New's arithmetic
  // preview of what the engine does server-side; the next read replaces them), and so do the cards.
  class blackoutChain extends ActionChain {
    async run(context, { key }) {
      const { $page } = context;
      const v = $page.variables;
      const fns = $page.functions;
      const rows = v.rowsAll || [];
      const day = rows.find((r) => r.kind === 'day' && r.rowKey === key);
      if (!day) return;
      const redraw = () => { v.rowsAll = rows.map((r) => (r === day ? Object.assign({}, r) : r)); };
      if (day.locked || v.readOnly || v.isPosting) {
        redraw();
        bus.toast('This week has been posted, so its cost is frozen in the ledger. Reverse the week first, then post it again at the corrected amount.', 'warning');
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
        bus.toast('The day could not be updated' + (resp && resp.status ? ' (status ' + resp.status + ')' : '') + '.', 'error');
        return;
      }
      const nowBlackout = wanted === 'BLACKOUT';
      const delta = nowBlackout ? -Number(day.dayCost || 0) : Number(day.restoreCost || day.dayCost || 0);
      const round2 = (n) => Math.round(n * 100) / 100;
      const next = rows.map((r) => {
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
      const hdr = fns.hdrOf(v.row);
      const plan = costPosting.plan(next, hdr, v.row && v.row.rateScheduleId);
      const table = fns.tableRows(next, hdr);
      const facts = costPosting.refigure(v.facts, next, delta);
      const label = costPosting.dayLabel(day.label);
      v.rowsAll = next;
      v.plan = plan;
      v.table = table;
      v.facts = facts;
      bus.toast(label + (nowBlackout ? ' is excluded: it will not be billed.' : ' will be billed again.'), 'info');
    }
  }

  return blackoutChain;
});
