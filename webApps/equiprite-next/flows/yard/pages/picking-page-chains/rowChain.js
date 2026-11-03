define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // A row of the list (one handler for the whole row): its request number opens the request in its own tab; anywhere
  // else opens the request in its dialog. Not while a step is in flight. (The dialog's Close closes it: a row never
  // toggles it shut.)
  class rowChain extends ActionChain {
    async run(context, { id, number, act }) {
      const v = context.$page.variables;
      if (!id) return;
      if (act === 'request') {
        bus.open({ record: 'request', params: { id: Number(id), number: number || '' } });
        return;
      }
      if (v.busy) return;
      v.from = { label: '' };
      await Actions.callChain(context, { chain: 'openWorkChain', params: { id: String(id), keepBanner: String(v.openId) === String(id) } });
    }
  }

  return rowChain;
});
