define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/approveAllocate',
  'resources/js/approvalQueue',
  'resources/js/mobileApprove',
  'resources/js/requestData',
  'resources/js/mobileBus',
], (ActionChain, Actions, aa, queue, ma, requestData, bus) => {
  'use strict';

  // Assign the suggested units of every line that has some, in one tap (Next's autoChain, FDD 7.8 auto-allocate):
  // each line is saved as New EquipRite saves a line's units (saveAllocationChain, as approveAllocate.saveAllocation:
  // the Transfer Order gate and the stale check read first, then the allocation, the unit, the line), one line after
  // another, exactly what suggestChain staged; a line that fails is reported and the next still runs. Added on a
  // phone: nothing is sent with no connection. Then the queue and the request are read again; once nothing is left to
  // assign, what happened and what is next up.
  class autoChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const pv = $page.variables;
      const head = pv.rec && pv.rec.head ? JSON.parse(JSON.stringify(pv.rec.head)) : null;
      const plan = pv.sugg && pv.sugg.plan ? JSON.parse(JSON.stringify(pv.sugg.plan)) : null;
      if (pv.busy || !pv.canAct || !head || !head.id || !plan || !plan.count) return;
      if (!ma.online(typeof navigator !== 'undefined' ? navigator : null)) {
        bus.toast(ma.OFFLINE, 'warning');
        return;
      }
      const key = String(pv.current.key);
      const order = (pv.shown || []).map((c) => c.key);
      const chip = pv.chip;
      const items = [];
      let worst = 'ok';
      pv.busy = true;
      // A line's unit sheet open by hand would show staging made before these saves: it closes.
      pv.picker = { lineId: '' };
      $page.functions.clearPicker();
      try {
        for (let i = 0; i < plan.lines.length; i++) {
          const p = $page.functions.suggestion(plan.lines[i].id);
          if (!p) continue;
          const lineData = p.lineData();
          const staged = p.getStagedChanges();
          const words = p.plan();
          pv.busyText = 'Assigning units: line ' + lineData.line_no + ' (' + (i + 1) + ' of ' + plan.lines.length + ')…';
          const res = await aa.saveAllocation(context, Actions, { requestId: Number(head.id), lineData, staged });
          const w = queue.saveWords(lineData, res, words);
          if (w.tone === 'error') worst = 'error';
          items.push(w.text);
        }
      } finally {
        pv.busy = false;
        pv.busyText = '';
      }
      const left = plan.none.length ? ' Without a free unit: ' + plan.none.join('; ') + '.' : '';
      const result = { tone: worst, text: (worst === 'error' ? 'Auto-allocate finished with problems on ' : 'Auto-allocate assigned units on ') + head.number + '.' + left, items };
      const toast = worst === 'error' ? 'Auto-allocate finished with problems on ' + head.number + '.'
        : 'Units assigned to ' + items.length + (items.length === 1 ? ' line' : ' lines') + ' on ' + head.number + '.';
      bus.toast(toast, worst === 'error' ? 'error' : 'info');
      requestData.invalidate();
      await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } });
      await Actions.callChain(context, { chain: 'recordChain', params: { keep: true } });
      pv.sheet = '';
      if (worst !== 'error') pv.cleared = (pv.cleared || 0) + 1;
      if (worst !== 'error' && !(pv.all || []).some((c) => c.key === key)) {
        pv.done = ma.done({ action: 'units', words: { tone: 'ok', text: toast + left }, items, key, number: head.number,
          list: JSON.parse(JSON.stringify(pv.all || [])), order, chip });
        pv.view = 'done';
        if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
        return;
      }
      pv.result = result;
    }
  }

  return autoChain;
});
