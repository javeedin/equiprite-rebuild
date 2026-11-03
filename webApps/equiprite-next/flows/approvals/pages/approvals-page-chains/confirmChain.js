define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/confirmPicking',
  'resources/js/requestData',
  'resources/js/shellBus',
], (ActionChain, Actions, confirmPicking, requestData, bus) => {
  'use strict';

  // Every line has its units: Confirm for picking, here (confirmPicking: Fusion is asked for the transfer order through
  // OIC, the pieces are scheduled for picking). Then the queue and the open request are read again.
  class confirmChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const head = (v.rec && v.rec.head) || {};
      if (v.busy || !v.canAct || !head.id) return;
      v.busy = true;
      v.busyWhere = 'panel';
      v.busyText = 'Asking Fusion for the transfer order for ' + head.number + '…';
      v.result = null;
      let out;
      try {
        out = await confirmPicking.confirm(context, Actions, { requestId: Number(head.id), requestNumber: head.number, endDate: head.end });
      } catch (e) {
        console.error('[approvals confirmChain] failed', e);
        out = { tone: 'error', text: 'Something went wrong (' + ((e && e.message) || e) + '). ' + head.number + ' is read again.', changed: true };
      } finally {
        v.busy = false;
        v.busyText = '';
        v.busyWhere = '';
      }
      v.result = { tone: out.tone === 'warn' ? 'warn' : out.tone, text: (out.title ? out.title + ': ' : '') + out.text, items: [] };
      bus.toast(head.number + ': ' + out.text, out.tone === 'error' ? 'error' : (out.tone === 'warn' ? 'warning' : 'info'));
      if (out.changed) {
        requestData.invalidate();
        const keep = v.result;
        await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true, reopen: true } });
        v.result = keep;
      }
    }
  }

  return confirmChain;
});
