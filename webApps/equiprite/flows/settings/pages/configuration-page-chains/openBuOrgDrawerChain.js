define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/openBuOrgDrawerChain.js: open Add mapping
  // with a clean in-progress mapping. The old chain also reset two data providers (the configured-BU picker and the
  // yard picker); here the BU choice is the Business unit settings rows already on the page, and the yards are
  // loaded by loadBuOrgYardsChain once a BU is picked, so both are simply cleared.
  class openBuOrgDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      $page.variables.BuOrgSelectedBUId   = null;
      $page.variables.BuOrgSelectedBUName = '';
      $page.variables.currentMapping = {
        buId: null, buName: '',
        orgId: null, orgName: '', orgCode: '', location: '', status: '',
        yardType: null, isTransactable: 'Y', subinventoryCode: null
      };
      $page.variables.BuOrgSubinvArray = [];
      $page.variables.BuOrgYardArray = [];
      $page.variables.pick = Object.assign({}, $page.variables.pick || {}, { orgBu: '', yard: '' });

      $page.variables.isBuOrgDrawerOpen = true;
    }
  }

  return openBuOrgDrawerChain;
});
