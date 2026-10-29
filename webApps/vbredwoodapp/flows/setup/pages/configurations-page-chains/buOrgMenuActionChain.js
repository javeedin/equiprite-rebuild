define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Route the BU & Org row menu selection to the matching flow, passing the row
  // stashed by openBuOrgRowMenuChain. Edit → openBuOrgEditChain (yard-type dialog);
  // Delete → openDeleteBuOrgChain (confirm dialog).
  class buOrgMenuActionChain extends ActionChain {
    async run(context, { actionId } = {}) {
      const { $page } = context;
      const rowKey = $page.variables.BuOrgMenuRowKey;
      if (rowKey == null || !actionId) return;

      if (actionId === 'edit') {
        await Actions.callChain(context, { chain: 'openBuOrgEditChain', params: { rowKey: rowKey } });
      } else if (actionId === 'delete') {
        await Actions.callChain(context, { chain: 'openDeleteBuOrgChain', params: { rowKey: rowKey } });
      }
    }
  }

  return buOrgMenuActionChain;
});
