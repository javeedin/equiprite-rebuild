define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // Closes what is beside the list (a request, or the unit search with its camera). Not while a step is in flight.
  class closeWorkChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      if (v.busy) return;
      await Actions.callChain(context, { chain: 'closeScannerChain' });
      v.side = '';
      v.openId = '';
      v.exportOpen = '';
      v.ticks = [];
      v.returnDate = '';
      v.banner = { type: '', text: '' };
      v.workError = '';
      v.work = { req: {}, lines: [], tos: [], yards: '' };
    }
  }

  return closeWorkChain;
});
