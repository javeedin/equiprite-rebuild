define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/maintenanceWorkOrders',
], (ActionChain, Actions, maintenanceWorkOrders) => {
  'use strict';

  // Fusion maintenance work orders for this equipment's maintenance assets (the master's and its units'), through
  // resources/js/maintenanceWorkOrders.fetchByAsset: one asset per request, the asset resolved first through
  // installedBaseAssets. The same helper the old equipment schedule and line detail use. Read only; failures cost
  // the maintenance light, never the page. Runs on entry up to 25 assets, otherwise from the button.
  class loadWorkOrdersChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const v = $page.variables;
      if (v.woLoading) return;
      v.woLoading = true;
      try {
        const rows = [v.masterRecord].concat(v.unitsArray || []);
        const byAsset = await maintenanceWorkOrders.fetchByAsset(context, Actions, rows);
        v.workOrders = $page.functions.workOrderRows(byAsset);
        v.woLoaded = true;
      } catch (e) {
        console.warn('[loadWorkOrdersChain] work orders unavailable', e);
        v.workOrders = [];
        v.woLoaded = false;
      } finally {
        v.woLoading = false;
      }
    }
  }

  return loadWorkOrdersChain;
});
