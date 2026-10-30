define([
  'vb/action/actionChain',
  'resources/js/mobileBus',
], (ActionChain, bus) => {
  'use strict';

  // A step on the open request, taken in the tab that takes it (each offered only when access allows, trackList):
  //   approve   the Approve tab, on this request
  //   pick      the Pick tab, on this request
  //   continue  the Request tab, carrying on with this draft (or a request sent back)
  const TAB = { approve: 'approve', pick: 'pick', continue: 'request' };

  class actChain extends ActionChain {
    async run(context, { act }) {
      const sel = context.$page.variables.sel || {};
      const tab = TAB[act];
      if (!tab || !sel.number) return;
      bus.focus(tab, { id: sel.id, number: sel.number });
    }
  }

  return actChain;
});
