define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/confirmPicking',
  'resources/js/requestData',
  'resources/js/shellBus',
], (ActionChain, Actions, confirmPicking, requestData, bus) => {
  'use strict';

  // Confirm for picking from the yard's screen (confirmPicking: Fusion is asked for the transfer order through OIC, the
  // pieces are scheduled for picking): the pieces of the open request whose unit is assigned (where: 'work'), or the
  // request handed over that is not in the yard's queue yet (where: 'handed'). Then the list is read again and the
  // request opens with its pieces in the queue. The Equipment Manager's step: full access to Approve & allocate.
  class confirmChain extends ActionChain {
    async run(context, { where }) {
      const v = context.$page.variables;
      if (v.busy) return;
      const fromHand = where === 'handed';
      const req = fromHand ? { id: v.handed.id, number: v.handed.number, end: v.handed.end } : {
        id: (v.work.req && (v.work.req.eqrEquipmentRequestId || v.work.req.id)) || v.openId,
        number: (v.work.req && v.work.req.requestNumber) || '', end: (v.work.req && v.work.req.end) || '',
      };
      if (!req.id) return;
      v.busy = 'confirm';
      let out;
      try {
        out = await confirmPicking.confirm(context, Actions, { requestId: Number(req.id), requestNumber: req.number, endDate: req.end });
      } catch (e) {
        console.error('[confirmChain] failed', e);
        out = { tone: 'error', title: 'Not confirmed', text: 'Something went wrong (' + ((e && e.message) || e) + '). It is read again.', changed: true };
      } finally {
        v.busy = '';
      }
      const type = { ok: 'confirmation', warn: 'warning', error: 'error' }[out.tone] || 'info';
      bus.toast(req.number + ': ' + out.text, out.tone === 'error' ? 'error' : (out.tone === 'warn' ? 'warning' : 'info'));
      if (out.changed) requestData.invalidate();
      if (fromHand) {
        v.handed = Object.assign({}, v.handed, { tone: out.ok ? 'ok' : 'wait', title: out.title, text: out.text, confirm: out.changed ? 0 : v.handed.confirm });
        if (out.changed) {
          await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } });
          const rec = (v.records || []).filter((r) => String(r.eqrEquipmentRequestId) === String(req.id))[0];
          if (rec) await Actions.callChain(context, { chain: 'openWorkChain', params: { id: String(rec.id || rec.eqrEquipmentRequestId), keepBanner: false } });
          if (rec) v.banner = { type, text: out.text };
        }
        return;
      }
      if (out.changed) {
        await Actions.callChain(context, { chain: 'refreshRowChain', params: { id: String(v.openId) } });
        await Actions.callChain(context, { chain: 'openWorkChain', params: { id: String(v.openId), keepBanner: true } });
      }
      v.banner = { type, text: out.text };
    }
  }

  return confirmChain;
});
