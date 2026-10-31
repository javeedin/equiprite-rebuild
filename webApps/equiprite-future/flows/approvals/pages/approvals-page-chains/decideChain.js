define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/approveAllocate',
  'resources/js/approvalQueue',
  'resources/js/requestData',
  'resources/js/shellBus',
], (ActionChain, Actions, aa, queue, requestData, bus) => {
  'use strict';

  // Approve or send back the open request: the ticked lines, or every line (New EquipRite's confirmRequestChain and
  // rejectRequestChain, as approveAllocate.approve / reject). Send back asks first, with a reason; once the lines are
  // sent back, the reason goes to the requester (approveAllocate.notifySentBack). Then the request and the queue are
  // read again, so what shows is what is stored.
  //   action: approve | askReject | cancel | reject
  class decideChain extends ActionChain {
    async run(context, { action }) {
      const v = context.$page.variables;
      if (action === 'askReject') { v.confirm = 'reject'; v.formError = ''; return; }
      if (action === 'cancel') { v.confirm = ''; v.formError = ''; return; }
      if (action !== 'approve' && action !== 'reject') return;
      const head = v.rec && v.rec.head;
      if (v.busy || !v.canAct || !head || !head.id || head.status !== 'SUBMITTED') return;
      const reason = String(v.reason || '').trim();
      if (action === 'reject' && !reason) {
        v.formError = 'Write the reason first: ' + (head.requestor || 'the requester') + ' gets it with the request.';
        return;
      }
      const all = v.lines || [];
      const pool = queue.pool(all, v.ticks);
      let words;
      let res;
      v.busy = true;
      v.busyWhere = 'panel';
      v.busyText = action === 'approve' ? 'Approving…' : 'Sending back…';
      v.picker = { lineId: '' };
      context.$page.functions.clearPicker();
      try {
        if (action === 'approve') {
          res = await aa.approve(context, Actions, { requestId: Number(head.id), pool, allLines: all });
          words = queue.approveWords(head.number, res);
        } else {
          res = await aa.reject(context, Actions, { requestId: Number(head.id), pool, allLines: all });
          let note = null;
          if (res.ok) {
            note = await aa.notifySentBack(context, Actions, { userId: head.requestorUserId, requestId: head.id, requestNumber: head.number,
              reason, lines: res.updated, whole: res.requestRejected });
          }
          words = queue.rejectWords(head.number, res, note, head.requestor);
        }
      } catch (e) {
        console.error('[decideChain] failed', e);
        words = { tone: 'error', text: 'Something went wrong; ' + head.number + ' has been read again to show where it stands.' };
      } finally {
        v.busy = false;
        v.busyText = '';
      }
      v.result = words;
      v.confirm = '';
      if (res && res.ok) { v.reason = ''; v.ticks = []; }
      bus.toast(words.text, words.tone === 'error' ? 'error' : (words.tone === 'warn' ? 'warning' : 'info'));
      requestData.invalidate();
      await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } });
      await Actions.callChain(context, { chain: 'recordChain', params: { keep: true } });
    }
  }

  return decideChain;
});
