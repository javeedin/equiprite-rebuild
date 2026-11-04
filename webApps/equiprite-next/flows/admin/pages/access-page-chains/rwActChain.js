define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood header's secondary actions (Oracle's general overview page), each the chain of the current look's
  // button: Discard drops the changed levels; Export to Excel exports the matrix as shown. Save is its primary action.
  class rwActChain extends ActionChain {
    async run(context, { id }) {
      if (id === 'discard') await Actions.callChain(context, { chain: 'discardChain' });
      else if (id === 'export') await Actions.callChain(context, { chain: 'exportChain', params: { format: 'xlsx' } });
    }
  }

  return rwActChain;
});
