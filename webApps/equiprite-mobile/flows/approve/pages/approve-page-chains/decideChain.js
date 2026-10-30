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

  // Approve or send back the open request: the lines chosen, or every line. The calls, their order and their guards
  // are Next's decideChain's (New EquipRite's confirmRequestChain and rejectRequestChain, as approveAllocate.approve /
  // reject): only a SUBMITTED request, only with full access, a reason before sending back; once the lines are sent
  // back, the reason goes to the requester (approveAllocate.notifySentBack). Added on a phone: nothing is sent with no
  // connection. Then the queue is read again; once decided, what happened and what is next up (mobileApprove.done);
  // when nothing changed, the request is read again and says why.
  //   action: approve | reject
  class decideChain extends ActionChain {
    async run(context, { action }) {
      const { $page } = context;
      const pv = $page.variables;
      if (action !== 'approve' && action !== 'reject') return;
      const head = pv.rec && pv.rec.head ? JSON.parse(JSON.stringify(pv.rec.head)) : null;
      if (pv.busy || !pv.canAct || !head || !head.id || head.status !== 'SUBMITTED') return;
      const reason = String(pv.reason || '').trim();
      if (action === 'reject' && !reason) {
        pv.formError = 'Write the reason first: ' + (head.requestor || 'the requester') + ' gets it with the request.';
        return;
      }
      if (!ma.online(typeof navigator !== 'undefined' ? navigator : null)) {
        pv.formError = ma.OFFLINE;
        bus.toast(ma.OFFLINE, 'warning');
        return;
      }
      // Plain copies: the page's variables are replaced by the reads that follow.
      const all = JSON.parse(JSON.stringify(pv.lines || []));
      const pool = queue.pool(all, JSON.parse(JSON.stringify(pv.ticks || [])));
      const key = String(pv.current.key);
      const order = (pv.shown || []).map((c) => c.key);
      const chip = pv.chip;
      let words;
      let res;
      pv.busy = true;
      pv.busyText = action === 'approve' ? 'Approving…' : 'Sending back…';
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
        pv.busy = false;
        pv.busyText = '';
      }
      bus.toast(words.text, ma.toastTone(words.tone));
      requestData.invalidate();
      await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } });
      if (res && res.ok) {
        pv.cleared = (pv.cleared || 0) + 1;
        pv.reason = '';
        pv.ticks = [];
        pv.sheet = '';
        pv.done = ma.done({ action, words, key, number: head.number, list: JSON.parse(JSON.stringify(pv.all || [])), order, chip });
        pv.view = 'done';
        if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, 0);
        return;
      }
      pv.sheet = '';
      pv.result = words;
      await Actions.callChain(context, { chain: 'recordChain', params: { keep: true } });
    }
  }

  return decideChain;
});
