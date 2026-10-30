define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/mobileBus',
  'resources/js/mobilePick',
  'resources/js/mobileRecent',
], (ActionChain, Actions, bus, mp, recent) => {
  'use strict';

  // Opens the request another tab or a deep link handed over (My requests: "Pick 2 pieces"; ?tab=pick&number=…), once
  // the list has loaded (Next's focusChain; before the list is in, the load takes it when done). A request that is not
  // waiting at the yard is not in the list: a toast says so. A request older than the period shown (the last few days)
  // still opens: the list behind it shows every date.
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
      const item = (v.items || []).filter((it) => String(it.id) === String(rec.id))[0];
      if (item && v.period !== 'all' && !recent.recentAt(mp.lastAt(item), Date.now())) {
        v.period = 'all';
        await Actions.callChain(context, { chain: 'applyChain' });
      }
      await Actions.callChain(context, { chain: 'openWorkChain', params: { id: String(rec.id), keepBanner: false } });
    }
  }

  return focusChain;
});
