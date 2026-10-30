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

  // Saves what is staged in the unit sheet: Next's saveUnitsChain (New EquipRite's saveAllocationChain, as
  // approveAllocate.saveAllocation): the Transfer Order gate and the stale check read first; releases, then
  // assignments; the line's units counted again and its allocation status written. Added on a phone: nothing is sent
  // with no connection. Then the queue and the request (with its suggestions) are read again: saved, the sheet closes
  // (once nothing is left to assign, what is next up shows); with problems, the sheet reads the line's units again.
  class saveUnitsChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const pv = $page.variables;
      const head = pv.rec && pv.rec.head ? JSON.parse(JSON.stringify(pv.rec.head)) : null;
      const p = $page.functions.picker();
      const lineData = p.lineData();
      if (pv.busy || !pv.canAct || !head || !head.id || !lineData) return;
      const staged = p.getStagedChanges();
      if (!staged.pendingAssignments.length && !staged.pendingReleases.length) {
        pv.pickNote = 'Nothing to save: use or release a unit first.';
        return;
      }
      if (!ma.online(typeof navigator !== 'undefined' ? navigator : null)) {
        pv.pickNote = ma.OFFLINE;
        bus.toast(ma.OFFLINE, 'warning');
        return;
      }
      const plan = p.plan();
      const lineId = String(pv.picker.lineId);
      const key = String(pv.current.key);
      const order = (pv.shown || []).map((c) => c.key);
      const chip = pv.chip;
      let res;
      pv.busy = true;
      pv.busyText = 'Saving the units of line ' + lineData.line_no + '…';
      try {
        res = await aa.saveAllocation(context, Actions, { requestId: Number(head.id), lineData, staged });
      } catch (e) {
        console.error('[saveUnitsChain] failed', e);
      } finally {
        pv.busy = false;
        pv.busyText = '';
      }
      const words = queue.saveWords(lineData, res, plan);
      bus.toast(words.text, words.tone === 'error' ? 'error' : 'info');
      requestData.invalidate();
      await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } });
      await Actions.callChain(context, { chain: 'recordChain', params: { keep: true } });
      if (words.tone === 'error') {
        pv.result = words;
        await Actions.callChain(context, { chain: 'unitsChain', params: { lineId, reload: true } });
        return;
      }
      pv.picker = { lineId: '' };
      $page.functions.clearPicker();
      pv.sheet = '';
      pv.cleared = (pv.cleared || 0) + 1;
      if (!(pv.all || []).some((c) => c.key === key)) {
        pv.done = ma.done({ action: 'units', words, key, number: head.number, list: JSON.parse(JSON.stringify(pv.all || [])), order, chip });
        pv.view = 'done';
        if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
        return;
      }
      pv.result = words;
    }
  }

  return saveUnitsChain;
});
