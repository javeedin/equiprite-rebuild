define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // New EquipRite: the yards (inventory organizations) of the BU picked in Add mapping. The same query as the old
  // page's yard data provider (BuOrgYardSDP): ProjectLOV inventoryOrganizations, q ManagementBusinessUnitId=<BU>,
  // the same fields, limit 200. Read only.
  class loadBuOrgYardsChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const buId = $page.variables.BuOrgSelectedBUId;
      $page.variables.BuOrgYardArray = [];
      if (buId == null || buId === '') return;

      $page.variables.isBuOrgYardLoading = true;
      try {
        const res = await Actions.callRest(context, {
          endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05InventoryOrganizations',
          uriParams: {
            q: 'ManagementBusinessUnitId=' + buId,
            fields: 'OrganizationId,OrganizationCode,OrganizationName,ManagementBusinessUnitId,LocationCode,Status',
            limit: 200
          }
        });
        if (res && res.ok) {
          $page.variables.BuOrgYardArray = (res.body && res.body.items) || [];
        } else {
          console.error('loadBuOrgYardsChain: failed', res && res.statusCode);
        }
      } catch (e) {
        console.error('loadBuOrgYardsChain: exception', e);
      } finally {
        $page.variables.isBuOrgYardLoading = false;
      }
    }
  }

  return loadBuOrgYardsChain;
});
