define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood view's header actions (Oracle's page templates give the clicked one's id), each the chain the current
  // look's own button calls:
  //   sync      Sync from Fusion (it asks first)       import    the Import from Fusion view (FULL)
  //   refresh   read the list again                    export    the view's rows to Excel (the Import view's)
  class rwActionChain extends ActionChain {
    async run(context, { id }) {
      if (id === 'sync') await Actions.callChain(context, { chain: 'SyncFromFusionChain', params: {} });
      else if (id === 'import') await Actions.callChain(context, { chain: 'setChain', params: { field: 'view', value: 'import' } });
      else if (id === 'refresh') await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } });
      else if (id === 'export') await Actions.callChain(context, { chain: 'exportChain', params: { format: 'xlsx' } });
    }
  }

  return rwActionChain;
});
