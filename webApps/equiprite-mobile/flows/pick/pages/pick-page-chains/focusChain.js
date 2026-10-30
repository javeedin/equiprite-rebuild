define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/mobileBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // Opens the request another tab or a deep link handed over (My requests: "Pick 2 pieces"; ?tab=pick&number=…), once
  // the list has loaded (Next's focusChain; before the list is in, the load takes it when done). A request that is not
  // waiting at the yard is not in the list: a toast says so.
  class focusChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      if (v.isLoading) return;
      const what = bus.takeFocus('pick');
      if (!what) return;
      const rec = (v.records || []).filter((r) => (what.id && String(r.eqrEquipmentRequestId) === String(what.id))
        || (what.number && r.requestNumber === String(what.number)))[0];
      if (!rec) {
        bus.toast((what.number || 'That request') + ' has nothing waiting at the yard to pick or ship.', 'info');
        return;
      }
      if (v.busy) return;
      if (v.view === 'work' && String(v.openId) === String(rec.id)) return;
      await Actions.callChain(context, { chain: 'openWorkChain', params: { id: String(rec.id), keepBanner: false } });
    }
  }

  return focusChain;
});
