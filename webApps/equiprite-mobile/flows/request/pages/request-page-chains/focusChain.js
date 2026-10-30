define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/mobileBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // A request another tab or a deep link asked for (mobileBus.focus('request', { id, number })): My requests' "Carry
  // on with this draft" and "Fix it and send it again", or ?tab=request&number=…. Opened once this tab has loaded
  // (initChain takes it at its end); resumeChain decides how, from the request's status.
  class focusChain extends ActionChain {
    async run(context) {
      const pv = context.$page.variables;
      if (pv.isLoading) return;
      const want = bus.takeFocus('request');
      if (!want || (!want.id && !want.number)) return;
      await Actions.callChain(context, { chain: 'resumeChain', params: { id: want.id ? String(want.id) : '', number: want.number || '', mode: '' } });
    }
  }

  return focusChain;
});
