define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood header's buttons (Oracle's general overview page), each the chain of the current look's button: Refresh
  // reads the open question again; Export to Excel exports the table below as shown.
  class rwActChain extends ActionChain {
    async run(context, { id }) {
      if (id === 'refresh') await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } });
      else if (id === 'export') await Actions.callChain(context, { chain: 'exportChain', params: { format: 'xlsx' } });
    }
  }

  return rwActChain;
});
