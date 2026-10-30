define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/mobileBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // A request another tab or a deep link asked for (mobileBus.focus('track', { id, number })): opened once the list
  // has it. Before the list has loaded, the load takes it when done.
  class focusChain extends ActionChain {
    async run(context) {
      const pv = context.$page.variables;
      if (pv.isLoading) return;
      const want = bus.takeFocus('track');
      if (!want) return;
      const hit = (pv.all || []).filter((c) => (want.number && c.number === String(want.number)) || (want.id && c.id === Number(want.id)))[0];
      if (!hit) {
        bus.toast('Request ' + (want.number || want.id) + ' is not in your list.', 'warning');
        return;
      }
      await Actions.callChain(context, { chain: 'openChain', params: { number: hit.number } });
    }
  }

  return focusChain;
});
