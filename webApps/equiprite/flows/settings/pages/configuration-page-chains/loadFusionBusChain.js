define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // New EquipRite: the Fusion business units for Add business unit settings. Same endpoint as the old drawer's
  // picker (EsBuLovSDP: ProjectLOV finBusinessUnitsLOV, limit 500), read once and searched on the page. Read only.
  class loadFusionBusChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      if (($page.variables.FusionBuList || []).length) return;
      $page.variables.isFusionBuLoading = true;
      try {
        const res = await Actions.callRest(context, {
          endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05FinBusinessUnitsLOV',
          uriParams: { fields: 'BusinessUnitId,BusinessUnitName', limit: 500 }
        });
        $page.variables.FusionBuList = (res && res.ok && res.body && res.body.items) || [];
        if (!res || !res.ok) {
          console.error('loadFusionBusChain: failed', res && res.statusCode);
        }
      } catch (e) {
        console.error('loadFusionBusChain: exception', e);
      } finally {
        $page.variables.isFusionBuLoading = false;
      }
    }
  }

  return loadFusionBusChain;
});
