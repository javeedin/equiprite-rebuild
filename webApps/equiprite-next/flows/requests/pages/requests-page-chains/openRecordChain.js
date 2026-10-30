define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/shellBus'], (ActionChain, Actions, bus) => {
  'use strict';

  // A row: anywhere opens the request in a tab of its own (the shell keeps this list's tab as it is); its step icons
  // (data-act) take that step instead:
  //   approve   decide it here, in a popup (popChain)
  //   history   its timeline from start to end, in a popup (popChain)
  //   assign    Approve & allocate, opened on it (units to assign)
  //   pick      Picking & shipping, opened on it
  class openRecordChain extends ActionChain {
    async run(context, { id, number, act }) {
      if (!id && !number) return;
      if (act === 'approve' || act === 'history') {
        await Actions.callChain(context, { chain: 'popChain', params: { action: act, id: String(id || ''), number: number || '' } });
        return;
      }
      if (act === 'assign') {
        bus.focus('approvals', { id: id ? Number(id) : undefined, number: number || '' });
        return;
      }
      if (act === 'pick') {
        bus.focus('picking', { id: id ? Number(id) : undefined, number: number || '' });
        return;
      }
      bus.open({ record: 'request', params: { id: id ? Number(id) : undefined, number: number || '' } });
    }
  }

  return openRecordChain;
});
