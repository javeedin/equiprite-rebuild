define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Redwood header's actions, as Current's buttons: export (to Excel), refresh.
  class rwChain extends ActionChain {
    async run(context, { id }) {
      const key = id && typeof id === 'object' ? String(id.id || '') : String(id || '');
      if (key === 'export') await Actions.callChain(context, { chain: 'exportChain', params: { format: 'xlsx' } });
      else if (key === 'refresh') await Actions.callChain(context, { chain: 'loadChain', params: { refresh: true } });
    }
  }

  return rwChain;
});
