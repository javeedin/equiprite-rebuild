define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/approveAllocate',
  'resources/js/approvalQueue',
  'resources/js/unitPicker',
  'resources/js/rules',
], (ActionChain, Actions, aa, queue, unitPicker, rules) => {
  'use strict';

  // The suggested units of the open request: for each line that can take units and still needs some, the unit
  // picker's reads and gates (approveAllocate.loadUnits: the line's units over its dates, whether a Transfer Order
  // locks it), then New EquipRite's Auto-fill (fillFree: free units in the order the view lists them, up to the
  // line's quantity) staged in a picker of its own. Nothing is written: Auto-allocate saves exactly what is staged
  // here, line by line. The Transfer Orders are read once for every line; each save reads them again.
  class suggestChain extends ActionChain {
    async run(context, { seq }) {
      const { $page, $application } = context;
      const v = $page.variables;
      const app = $application.variables;
      const head = v.rec && v.rec.head;
      if (!head || !head.id) return;
      const still = () => v.recSeq === seq;
      const wanted = (v.rec.rows || []).filter((r) => r.action === 'allocate' && r.unitsTone !== 'complete');
      if (!wanted.length) {
        $page.functions.setSuggestions({});
        v.sugg = { loading: false, byLine: {}, plan: { count: 0, lines: [], none: [], label: '' } };
        return;
      }
      v.sugg = { loading: true, byLine: {}, plan: { count: 0, lines: [], none: [], label: '' } };
      const toRes = await Actions.callRest(context, { endpoint: 'eqp-v1/getTransferOrders', uriParams: { equipmentRequestId: Number(head.id) } })
        .catch(() => null);
      const tos = toRes && toRes.ok && toRes.body && Array.isArray(toRes.body.data) ? toRes.body.data : undefined;
      const byLine = {};
      const pickers = {};
      for (const row of wanted) {
        const line = (v.lines || []).filter((l) => l.lineId === row.id)[0];
        if (!line) continue;
        const u = await aa.loadUnits(context, Actions, {
          requestId: head.id, line, requestNumber: head.number, readOnly: !v.canAct, bookings: false, transferOrders: tos,
          isExternal: (source) => rules.isExternalSource(source),
          quotingOn: (source) => rules.isQuotingAllowed(app.globalSettings, app.flagsLoaded, source),
        });
        if (!still()) return;
        let s;
        if (u.error) {
          s = { error: u.error, picks: [], needed: 0, got: 0 };
        } else {
          const p = new unitPicker.Picker();
          p.initUnits(u.resources, u.allocated, u.allocLine, u.mode, u.confirmed, u.readOnly, [], head.number);
          const needed = p.remainingCapacity();
          const locked = !!(u.confirmed || u.readOnly);
          if (!locked && needed > 0) p.fillFree();
          const picks = p.suggestions();
          s = { error: '', locked, why: u.readOnlyWhy, mode: u.mode, needed, got: picks.reduce((n, x) => n + x.qty, 0), picks };
          if (picks.length && !locked) pickers[row.id] = p;
        }
        s.words = queue.suggestionWords(s);
        byLine[row.id] = s;
      }
      if (!still()) return;
      $page.functions.setSuggestions(pickers);
      v.sugg = { loading: false, byLine, plan: queue.autoPlan(v.rec.rows, byLine) };
    }
  }

  return suggestChain;
});
