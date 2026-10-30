define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // A row of the list (one handler for the whole row): its request number opens the request in its own tab; anywhere
  // else opens the request beside the list (in place of a unit search), or closes it when it is the one open.
  class rowChain extends ActionChain {
    async run(context, { id, number, act }) {
      const v = context.$page.variables;
      if (!id) return;
      if (act === 'request') {
        bus.open({ record: 'request', params: { id: Number(id), number: number || '' } });
        return;
      }
      if (v.busy) return;
      if (v.side === 'request' && String(v.openId) === String(id)) {
        await Actions.callChain(context, { chain: 'closeWorkChain' });
        return;
      }
      if (v.side === 'find') await Actions.callChain(context, { chain: 'closeScannerChain' });
      await Actions.callChain(context, { chain: 'openWorkChain', params: { id: String(id), keepBanner: false } });
    }
  }

  return rowChain;
});
