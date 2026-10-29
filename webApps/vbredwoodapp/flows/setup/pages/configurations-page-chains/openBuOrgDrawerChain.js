define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Open the BU & Org Mapping "Add" drawer. Reset the in-progress mapping so each
  // open starts clean, then reset the BU picker SDP + Yard SDP to their empty state
  // (no BU selected yet).
  //
  // The BU picker (BuOrgConfiguredBuSDP) is deliberately the BUs CONFIGURED in the
  // BU Settings tab — conf-equipment-settings, not all Fusion BUs — because you
  // assign inventory orgs to a BU you've already set up there. Its typed search is
  // server-side via the endpoint's ?q= (transforms/confEquipmentSettings.js).
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

      await Actions.resetVariables(context, {
        variables: ['$page.variables.BuOrgConfiguredBuSDP', '$page.variables.BuOrgYardSDP']
      });

      $page.variables.isBuOrgDrawerOpen = true;
    }
  }

  return openBuOrgDrawerChain;
});
