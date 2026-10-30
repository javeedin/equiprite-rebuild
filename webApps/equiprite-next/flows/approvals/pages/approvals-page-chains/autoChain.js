define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/approveAllocate',
  'resources/js/approvalQueue',
  'resources/js/requestData',
  'resources/js/shellBus',
], (ActionChain, Actions, aa, queue, requestData, bus) => {
  'use strict';

  // Auto-allocate (FDD 7.8): assign the suggested units of every line that has some. Asks first, listing them. Each
  // line is then saved as New EquipRite saves a line's units (saveAllocationChain, as approveAllocate.saveAllocation:
  // the Transfer Order gate and the stale check read first, then the allocation, the unit, the line), one line after
  // another; a line that fails is reported and the next still runs. Then the request is read again.
  //   action: ask | cancel | go
  class autoChain extends ActionChain {
    async run(context, { action }) {
      const { $page } = context;
      const v = $page.variables;
      if (action === 'ask') { v.confirm = 'auto'; return; }
      if (action === 'cancel') { v.confirm = ''; return; }
      if (action !== 'go') return;
      const head = v.rec && v.rec.head;
      const plan = v.sugg && v.sugg.plan;
      if (v.busy || !v.canAct || !head || !head.id || !plan || !plan.count) return;
      const items = [];
      let worst = 'ok';
      v.busy = true;
      v.busyWhere = 'panel';
      // A line's picker open by hand would show staging made before these saves: it closes.
      v.picker = { lineId: '' };
      $page.functions.clearPicker();
      try {
        for (let i = 0; i < plan.lines.length; i++) {
          const p = $page.functions.suggestion(plan.lines[i].id);
          if (!p) continue;
          const lineData = p.lineData();
          const staged = p.getStagedChanges();
          const words = p.plan();
          v.busyText = 'Assigning units: line ' + lineData.line_no + ' (' + (i + 1) + ' of ' + plan.lines.length + ')…';
          const res = await aa.saveAllocation(context, Actions, { requestId: Number(head.id), lineData, staged });
          const w = queue.saveWords(lineData, res, words);
          if (w.tone === 'error') worst = 'error';
          items.push(w.text);
        }
      } finally {
        v.busy = false;
        v.busyText = '';
      }
      const left = plan.none.length ? ' Without a free unit: ' + plan.none.join('; ') + '.' : '';
      v.result = { tone: worst, text: (worst === 'error' ? 'Auto-allocate finished with problems on ' : 'Auto-allocate assigned units on ') + head.number + '.' + left, items };
      v.confirm = '';
      bus.toast(worst === 'error' ? 'Auto-allocate finished with problems on ' + head.number + '.'
        : 'Units assigned to ' + items.length + (items.length === 1 ? ' line' : ' lines') + ' on ' + head.number + '.', worst === 'error' ? 'error' : 'info');
      requestData.invalidate();
      await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } });
      await Actions.callChain(context, { chain: 'recordChain', params: { keep: true } });
    }
  }

  return autoChain;
});
