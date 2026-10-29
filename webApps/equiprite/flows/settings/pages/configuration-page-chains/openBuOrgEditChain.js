define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/openBuOrgEditChain.js. Unchanged except the
  // dialog: the old dialog is an inline editor in its section (shown while its is…Open flag is true).

  // Edit affordance on a BU & Org mapping row: stash the row as the edit target
  // (id + read-only BU/yard labels + current yard type / transactable flag) and
  // open the edit dialog. Yard Type (orgRole) and Transactable are editable —
  // the BU + yard are the mapping's identity. Save runs from saveBuOrgEditChain.
  class openBuOrgEditChain extends ActionChain {
    async run(context, { rowKey } = {}) {
      const { $page } = context;
      if (rowKey == null) return;

      const row = ($page.variables.BuOrgMappingsArray || [])
        .find(function (r) { return r.rowKey === rowKey; });
      if (!row || row.id == null) return;

      $page.variables.BuOrgEditTarget = {
        id:       row.id,
        buName:   row.buName || '',
        orgName:  row.orgName || String(row.orgId || ''),
        orgCode:  row.orgCode || '',
        yardType: row.yardType || null,
        isTransactable: row.isTransactable === 'N' ? 'N' : 'Y',
        orgId:    row.orgId != null ? row.orgId : null,
        subinventoryCode: row.subinventoryCode || null
      };
      // Not awaited: the dialog opens at once and the picker fills in.
      Actions.callChain(context, {
        chain: 'loadBuOrgSubinventoriesChain',
        params: { orgId: row.orgId, keepCode: row.subinventoryCode || null }
      });

      $page.variables.isBuOrgEditOpen = true;
    }
  }

  return openBuOrgEditChain;
});
