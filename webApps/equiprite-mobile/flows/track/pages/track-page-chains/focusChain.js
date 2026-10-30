define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/mobileBus',
  'resources/js/mobileRecent',
], (ActionChain, Actions, bus, recent) => {
  'use strict';

  // A request another tab or a deep link asked for (mobileBus.focus('track', { id, number })): opened once the list
  // has it. Before the list has loaded, the load takes it when done. A request the list does not have yet (raised a
  // moment ago, or someone else's) is looked for in a fresh list, then, for a manager, in everyone's. An older request
  // than the period shows (the last few days) still opens: the list behind it shows every date.
  class focusChain extends ActionChain {
    async run(context) {
      const pv = context.$page.variables;
      if (pv.isLoading) return;
      const want = bus.takeFocus('track');
      if (!want) return;
      const find = () => (pv.all || []).filter((c) => (want.number && c.number === String(want.number)) || (want.id && c.id === Number(want.id)))[0];
      let hit = find();
      if (!hit) {
        await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } });
        hit = find();
      }
      if (!hit && pv.manager && pv.scope !== 'all') {
        await Actions.callChain(context, { chain: 'loadChain', params: { refresh: false, scope: 'all' } });
        hit = find();
      }
      if (!hit) {
        bus.toast('Request ' + (want.number || want.id) + ' is not in your list.', 'warning');
        return;
      }
      if (pv.period !== 'all' && !recent.isRecent(hit, Date.now())) {
        await Actions.callChain(context, { chain: 'applyChain', params: { period: 'all' } });
      }
      await Actions.callChain(context, { chain: 'openChain', params: { number: hit.number } });
    }
  }

  return focusChain;
});
