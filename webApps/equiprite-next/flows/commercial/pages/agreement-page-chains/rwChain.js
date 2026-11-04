define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood look's header (your menu, Look: Oracle's general overview page over this tab's own body). Each of its
  // actions calls the chain the Current look's button calls, on the same state:
  //   primary   the white button: Approve (approveChain) on the agreement, Save or Create (saveChain) on its form
  //   act       a header action, by its id: reject (asks first, rejectChain), edit, export (the lines shown, to Excel),
  //             refresh, cancel (the form's Cancel or Close)
  //   back      in-flow back: the Agreements tab (uiChain list, as the page's "Open Agreements")
  class rwChain extends ActionChain {
    async run(context, { action, value }) {
      const v = context.$page.variables;
      if (action === 'primary') {
        await Actions.callChain(context, { chain: v.mode === 'edit' ? 'saveChain' : 'approveChain' });
        return;
      }
      if (action === 'back') {
        await Actions.callChain(context, { chain: 'uiChain', params: { action: 'list' } });
        return;
      }
      if (action !== 'act') return;
      const id = value && typeof value === 'object' ? String(value.id || '') : String(value || '');
      if (id === 'reject') {
        await Actions.callChain(context, { chain: 'rejectChain', params: {} });
      } else if (id === 'edit') {
        await Actions.callChain(context, { chain: 'uiChain', params: { action: 'edit', value: '' } });
      } else if (id === 'export') {
        await Actions.callChain(context, { chain: 'exportChain', params: { format: 'xlsx' } });
      } else if (id === 'refresh') {
        await Actions.callChain(context, { chain: 'uiChain', params: { action: 'refresh', value: '' } });
      } else if (id === 'cancel') {
        await Actions.callChain(context, { chain: 'uiChain', params: { action: 'cancelEdit', value: '' } });
      }
    }
  }

  return rwChain;
});
