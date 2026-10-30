define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // Opens the request another screen handed over (Requests: "Pick"), beside the list, once the list has loaded. A
  // request that is not waiting at the yard is not in the list: a toast says so.
  class focusChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      for (let i = 0; i < 600 && v.isLoading; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const what = bus.takeFocus('picking');
      if (!what) return;
      const rec = (v.records || []).filter((r) => (what.id && String(r.eqrEquipmentRequestId) === String(what.id))
        || (what.number && r.requestNumber === what.number))[0];
      if (!rec) {
        bus.toast((what.number || 'That request') + ' has nothing waiting at the yard to pick or ship.', 'info');
        return;
      }
      if (String(v.openId) === String(rec.eqrEquipmentRequestId)) return;
      await Actions.callChain(context, { chain: 'rowChain', params: { id: String(rec.eqrEquipmentRequestId), number: rec.requestNumber, act: 'open' } });
    }
  }

  return focusChain;
});
