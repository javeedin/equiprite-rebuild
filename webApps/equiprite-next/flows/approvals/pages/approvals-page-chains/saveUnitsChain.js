define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/approveAllocate',
  'resources/js/approvalQueue',
  'resources/js/requestData',
  'resources/js/shellBus',
], (ActionChain, Actions, aa, queue, requestData, bus) => {
  'use strict';

  // Saves what is staged in the open unit picker: New EquipRite's saveAllocationChain (approveAllocate.saveAllocation):
  // the Transfer Order gate and the stale check read first; releases, then assignments; the line's units counted
  // again and its allocation status written. Then the request, its suggestions and the picker are read again.
  class saveUnitsChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      const head = v.rec && v.rec.head;
      const p = $page.functions.picker();
      const lineData = p.lineData();
      if (v.busy || !v.canAct || !head || !head.id || !lineData) return;
      const staged = p.getStagedChanges();
      if (!staged.pendingAssignments.length && !staged.pendingReleases.length) {
        v.pickNote = 'Nothing to save: assign or release a unit first.';
        return;
      }
      const plan = p.plan();
      const lineId = String(v.picker.lineId);
      let res;
      v.busy = true;
      v.busyWhere = 'panel';
      v.busyText = 'Saving the units of line ' + lineData.line_no + '…';
      try {
        res = await aa.saveAllocation(context, Actions, { requestId: Number(head.id), lineData, staged });
      } finally {
        v.busy = false;
        v.busyText = '';
      }
      const words = queue.saveWords(lineData, res, plan);
      v.result = words;
      bus.toast(words.text, words.tone === 'error' ? 'error' : 'info');
      requestData.invalidate();
      await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } });
      await Actions.callChain(context, { chain: 'recordChain', params: { keep: true } });
      await Actions.callChain(context, { chain: 'unitsChain', params: { lineId, reload: true } });
    }
  }

  return saveUnitsChain;
});
