define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/openEsDrawerChain.js: opens Add business unit
  // settings with a clean draft. The old drawer's BU picker was a Fusion data provider (EsBuLovSDP); here the
  // same list (finBusinessUnitsLOV) is loaded once by loadFusionBusChain and searched on the page.
  class openEsDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      $page.variables.esIsEditMode = false;
      $page.variables.EsBuSelectedName = '';
      $page.variables.EsDraft = {
        buId: null, buName: '', buAttrs: null,
        RATE_SOURCE: '', PPM_TRANS_SOURCE: '', PPM_BATCH_PREFIX: '',
        PASS_PROCUREMENT_COST: false,
        ADHOC_TIMESHEET_ENABLED: false,
        // null, not 0: a new BU has expressed no markup policy, and null says that. Seeded here because
        // esColumnMap carries the key — see the wipe-hazard note there.
        MARGIN_PERCENTAGE: null
      };
      $page.variables.pick = Object.assign({}, $page.variables.pick || {}, { esBu: '' });

      $page.variables.isEsDrawerOpen = true;
      await Actions.callChain(context, { chain: 'loadFusionBusChain' });
    }
  }

  return openEsDrawerChain;
});
