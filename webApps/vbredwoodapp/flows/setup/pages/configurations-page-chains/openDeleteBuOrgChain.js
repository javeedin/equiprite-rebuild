define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Trash affordance on a BU & Org mapping row: stash the row as the delete
  // target (rowKey + org/BU names for the confirm message) and open the confirm
  // dialog. The actual removal runs from deleteBuOrgMappingRowChain on confirm.
  class openDeleteBuOrgChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { rowKey } = params || {};
      if (rowKey == null) return;

      const row = ($page.variables.BuOrgMappingsArray || [])
        .find(r => r.rowKey === rowKey);
      if (!row) return;

      $page.variables.DeleteBuOrgTarget = {
        rowKey:  row.rowKey,
        id:      row.id != null ? row.id : null,
        orgName: row.orgName || row.orgId || '',
        buName:  row.buName || ''
      };

      const dlg = document.getElementById('buOrgDeleteDialog');
      if (dlg) dlg.open();
    }
  }

  return openDeleteBuOrgChain;
});
