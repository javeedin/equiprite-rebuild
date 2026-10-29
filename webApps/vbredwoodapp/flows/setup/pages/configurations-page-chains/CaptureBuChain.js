define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // BU selected in the Add drawer. Capture BusinessUnitId/Name, then re-query the
  // dependent Yard dropdown (BuOrgYardSDP.q binds to BuOrgSelectedBUId), exactly
  // like task depends on project. Also clear any in-progress yard/type selection
  // so a BU change starts fresh.
  //
  // Two entry shapes:
  //   buId + buName — from the configured-BU oj-select-single's value-item (the
  //                   selected conf-equipment-settings row); null buId on clear.
  //   data          — legacy Fusion typeahead suggestion { BusinessUnitId, BusinessUnitName }.
  class CaptureBuChain extends ActionChain {
    async run(context, { data, buId, buName } = {}) {
      const { $page } = context;

      let id;
      let name;
      if (data) {
        id = data.BusinessUnitId || null;
        name = data.BusinessUnitName || '';
      } else {
        id = (buId != null && buId !== '') ? Number(buId) : null;
        name = (buName != null && buName !== '') ? String(buName) : (id != null ? String(id) : '');
      }

      $page.variables.BuOrgSelectedBUId   = id;
      $page.variables.BuOrgSelectedBUName = name;

      // Reset the in-progress mapping's yard/type (BU changed → previous yard invalid).
      $page.variables.currentMapping = Object.assign({}, $page.variables.currentMapping, {
        buId: id, buName: name,
        orgId: null, orgName: '', orgCode: '', location: '', status: '',
        yardType: null
      });

      // Refresh the Yard dropdown for the newly selected BU.
      await Actions.resetVariables(context, { variables: ['$page.variables.BuOrgYardSDP'] });
    }
  }

  return CaptureBuChain;
});
