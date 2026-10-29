define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Fills the Subinventory picker on BU Org Mapping (Add drawer and Edit
  // dialog) with the Fusion subinventories of one inventory org.
  // Disabled subinventories are left out, except the one already saved on the
  // mapping (keepCode), so an existing value still shows instead of a raw code.
  class loadBuOrgSubinventoriesChain extends ActionChain {
    async run(context, { orgId, keepCode } = {}) {
      const { $page } = context;
      $page.variables.BuOrgSubinvArray = [];
      if (orgId == null || orgId === '') return;

      $page.variables.isBuOrgSubinvLoading = true;
      let rows = [];
      try {
        const res = await Actions.callRest(context, {
          endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05Subinventories',
          uriParams: {
            q: 'OrganizationId=' + Number(orgId),
            fields: 'SecondaryInventoryName,Description,OrganizationId,DisableDate',
            limit: '500',
            onlyData: true
          }
        });
        if (res && res.ok) {
          rows = (res.body && res.body.items) || [];
        } else {
          console.error('loadBuOrgSubinventoriesChain: fetch failed', res && res.statusCode);
        }
      } catch (e) {
        console.error('loadBuOrgSubinventoriesChain: exception', e);
      }

      const today = new Date().toISOString().slice(0, 10);
      const list = rows
        .filter(r => r && r.SecondaryInventoryName)
        .filter(r => !r.DisableDate || String(r.DisableDate).slice(0, 10) > today ||
                     r.SecondaryInventoryName === keepCode)
        .map(r => ({
          value: r.SecondaryInventoryName,
          label: r.SecondaryInventoryName + (r.Description ? ' — ' + r.Description : '')
        }))
        .sort((a, b) => a.value.localeCompare(b.value));

      if (keepCode && !list.some(x => x.value === keepCode)) {
        list.unshift({ value: keepCode, label: keepCode + ' (not found in Fusion)' });
      }

      $page.variables.BuOrgSubinvArray = list;
      $page.variables.isBuOrgSubinvLoading = false;
    }
  }

  return loadBuOrgSubinventoriesChain;
});
