define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/CaptureBuChain.js: a BU picked in Add mapping.
  // Capture BusinessUnitId / Name and clear the yard and type chosen under the previous BU. The old chain then reset
  // the yard data provider (its q was bound to the BU); here loadBuOrgYardsChain makes that same query.
  //
  // Two entry shapes, as before:
  //   buId + buName — a configured BU (Business unit settings row); null buId on clear.
  //   data          — a Fusion BU row { BusinessUnitId, BusinessUnitName }.
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
      $page.variables.BuOrgSubinvArray = [];

      // Refresh the Yard choice for the newly selected BU.
      await Actions.callChain(context, { chain: 'loadBuOrgYardsChain' });
    }
  }

  return CaptureBuChain;
});
