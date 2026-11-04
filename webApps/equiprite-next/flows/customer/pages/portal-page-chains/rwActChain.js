define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood header's buttons (Oracle's general overview page, its secondary actions), each the chain of the current
  // look's button: Refresh reads the portal again; Export to Excel exports what the open view shows (under Redwood, the
  // Requests view's rows with their column filters).
  class rwActChain extends ActionChain {
    async run(context, { id }) {
      if (id === 'refresh') await Actions.callChain(context, { chain: 'loadChain' });
      else if (id === 'export') await Actions.callChain(context, { chain: 'exportChain', params: { format: 'xlsx', look: 'redwood' } });
    }
  }

  return rwActChain;
});
