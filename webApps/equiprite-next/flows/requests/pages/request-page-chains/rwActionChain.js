define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood look's header (Oracle's general overview page): each of its actions does what the current look's button
  // in the page head does, through the same chain.
  //   primary   the request's next step (the page module's rwPrimaryId: the first the request offers)
  //   finish    Finish this draft (finishDraftChain)
  //   approve | assign | pick   Approve & allocate, or Picking & shipping, opened on this request (stepChain)
  //   confirm | accept          asked once below the header, then done here (stepChain ask)
  //   edit      Edit request: its panel, to add or remove equipment before anyone decides it (editChain)
  //   refresh   Refresh (loadRecordChain)
  //   export    Export the equipment, as Excel (exportLinesChain)
  //   new       Act on it in New: this request in New EquipRite
  class rwActionChain extends ActionChain {
    async run(context, { id }) {
      const { $page, $application } = context;
      const v = $page.variables;
      const act = id === 'primary' ? $page.functions.rwPrimaryId(v.head, v.acts, v.stepBusy) : id;
      if (act === 'finish') { await Actions.callChain(context, { chain: 'finishDraftChain' }); return; }
      if (act === 'approve' || act === 'assign' || act === 'pick') {
        await Actions.callChain(context, { chain: 'stepChain', params: { act, value: '' } });
        return;
      }
      if (act === 'confirm' || act === 'accept') {
        await Actions.callChain(context, { chain: 'stepChain', params: { act: 'ask', value: act } });
        return;
      }
      if (act === 'edit') { await Actions.callChain(context, { chain: 'editChain', params: { act: v.edit && v.edit.on ? 'close' : 'open', value: '' } }); return; }
      if (act === 'refresh') { await Actions.callChain(context, { chain: 'loadRecordChain' }); return; }
      if (act === 'export') { await Actions.callChain(context, { chain: 'exportLinesChain', params: { format: 'xlsx' } }); return; }
      if (act === 'new') {
        const url = $page.functions.newUrl($application.variables.appUrls && $application.variables.appUrls.new, v.head);
        if (url) window.location.assign(url);
      }
    }
  }

  return rwActionChain;
});
