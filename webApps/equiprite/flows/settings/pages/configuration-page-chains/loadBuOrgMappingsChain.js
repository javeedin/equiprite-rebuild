define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/loadBuOrgMappingsChain.js, unchanged.

  // Load saved BU→Org role mappings (all BUs) into the mixed table on tab enter.
  //
  // The backend GET now returns every display field per row — buName, invOrgName,
  // invOrgCode, locationCode, orgRole — persisted in EQR_BU_ORG_MAPPING at upsert
  // time. So this is a SINGLE GET with NO Fusion calls. (Previously it made 1+N
  // live Fusion round-trips to resolve BU/yard names; the names are now stored, so
  // those calls were removed — see MD/BU_TO_ORG_MAP.md §9.)
  class loadBuOrgMappingsChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getBuOrgMappings'
      });

      if (!result.ok) {
        console.error('loadBuOrgMappingsChain: failed', result.statusCode);
        return;
      }

      // mapMappingRowsFromApi reads buName/invOrgName/etc. straight from the payload
      // and filters out inactive rows; no name resolution needed.
      const rows = $page.functions.mapMappingRowsFromApi(
        result.body, $page.variables.OrgRoleLovArray
      );

      $page.variables.BuOrgMappingsArray = rows;
      $page.variables.BuOrgFilterLovArray = $page.functions.buildBuFilterLov(rows);
    }
  }

  return loadBuOrgMappingsChain;
});
