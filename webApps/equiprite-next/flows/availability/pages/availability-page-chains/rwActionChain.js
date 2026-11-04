define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood header's actions (Oracle's general overview page gives the clicked one's id), each through the chain the
  // current look's head buttons call:
  //   refresh   read the fleet and its bookings again (loadChain)
  //   export    what the timeline or the yard grid shows, as Excel (exportChain)
  class rwActionChain extends ActionChain {
    async run(context, { id }) {
      if (id === 'refresh') await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } });
      else if (id === 'export') await Actions.callChain(context, { chain: 'exportChain', params: { format: 'xlsx' } });
    }
  }

  return rwActionChain;
});
