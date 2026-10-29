define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/captureBuOrgYardChain.js: a yard picked in Add
  // mapping. Capture the whole org row into currentMapping and load its subinventories. The old picker handed over
  // the row (data); the page's yard buttons hand over its id, looked up in the loaded yards.
  class captureBuOrgYardChain extends ActionChain {
    async run(context, { data, orgId } = {}) {
      const { $page } = context;
      if (!data && orgId != null && orgId !== '') {
        data = ($page.variables.BuOrgYardArray || [])
          .find(function (y) { return String(y.OrganizationId) === String(orgId); });
      }
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
