define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/shellBus'], (ActionChain, Actions, bus) => {
  'use strict';

  // A row: anywhere opens the request in a tab of its own (the shell keeps this list's tab as it is); its step icons
  // (data-act) take that step instead:
  //   approve   decide it here, in a popup (popChain)
  //   history   its timeline from start to end, in a popup (popChain)
  //   assign    Approve & allocate, opened on it (units to assign)
  //   confirm   getting it to site, in a popup (popChain road): pieces with their unit, waiting for Confirm
  //   pick      the same popup: pieces in the yard's queue, and Picking & shipping from there
  //   accept    the same popup: pieces on their way to site, accepted there
  class openRecordChain extends ActionChain {
    async run(context, { id, number, act }) {
      if (!id && !number) return;
      // The Redwood table's row action gives the row's key only: its number from the list.
      if (id && !number) {
        const row = (context.$page.variables.rows || []).filter((r) => String(r.eqrEquipmentRequestId) === String(id))[0];
        number = row ? row.requestNumber : '';
      }
      if (act === 'approve' || act === 'history' || act === 'confirm' || act === 'pick' || act === 'accept') {
        const action = act === 'confirm' || act === 'pick' || act === 'accept' ? 'road' : act;
        await Actions.callChain(context, { chain: 'popChain', params: { action, id: String(id || ''), number: number || '' } });
        return;
      }
      if (act === 'assign') {
        bus.focus('approvals', { id: id ? Number(id) : undefined, number: number || '', from: { label: 'Requests', open: { navId: 'requests' } } });
        return;
      }
      bus.open({ record: 'request', params: { id: id ? Number(id) : undefined, number: number || '' } });
    }
  }

  return openRecordChain;
});
