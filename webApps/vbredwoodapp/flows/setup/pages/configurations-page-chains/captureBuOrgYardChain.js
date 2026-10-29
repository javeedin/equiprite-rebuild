define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Yard selected from the drawer's Yard dropdown (inventory orgs under the BU).
  // Capture the full org row into currentMapping so the read-only table can show
  // Org Code / Org Id / Default Location / Status without re-fetching.
  class captureBuOrgYardChain extends ActionChain {
    async run(context, { data } = {}) {
      const { $page } = context;
      if (!data) return;

      $page.variables.currentMapping = Object.assign({}, $page.variables.currentMapping, {
        orgId:    data.OrganizationId   != null ? data.OrganizationId : null,
        orgName:  data.OrganizationName || '',
        orgCode:  data.OrganizationCode || '',
        location: data.LocationCode     || '',
        status:   data.Status           || '',
        // A subinventory belongs to one org: a new yard starts with none.
        subinventoryCode: null
      });
      await Actions.callChain(context, {
        chain: 'loadBuOrgSubinventoriesChain',
        params: { orgId: data.OrganizationId }
      });
    }
  }

  return captureBuOrgYardChain;
});
