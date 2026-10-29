define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/openDeleteBuOrgChain.js. Unchanged except the
  // dialog: the confirmation is the page's confirm card (confirmChain runs the delete on OK).

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

      $page.variables.confirm = {
        kind: 'deleteBuOrg',
        section: 'yards',
        title: 'Delete mapping',
        okLabel: 'Delete',
        danger: true,
        message: 'Permanently delete the mapping for "' + $page.variables.DeleteBuOrgTarget.orgName + '"'
          + ($page.variables.DeleteBuOrgTarget.buName ? ' from ' + $page.variables.DeleteBuOrgTarget.buName : '')
          + '? To disable it instead of removing it, use the Active switch.'
      };
    }
  }

  return openDeleteBuOrgChain;
});
