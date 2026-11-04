define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood header's buttons (Oracle's general overview page: its secondary actions, and back), each what the current
  // look's button does: Refresh reads the invoices again; Export to Excel exports them; Track the request opens it in its
  // tab; back is the portal.
  class rwActChain extends ActionChain {
    async run(context, { id }) {
      if (id === 'refresh') await Actions.callChain(context, { chain: 'loadInvoicesChain' });
      else if (id === 'export') await Actions.callChain(context, { chain: 'exportChain', params: { format: 'xlsx' } });
      else if (id === 'request') await Actions.callChain(context, { chain: 'openChain', params: { record: 'customer-request' } });
      else if (id === 'back') await Actions.callChain(context, { chain: 'openChain', params: { record: 'portal' } });
    }
  }

  return rwActChain;
});
