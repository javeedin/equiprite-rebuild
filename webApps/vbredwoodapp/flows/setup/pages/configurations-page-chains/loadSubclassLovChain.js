define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/bipLov',
], (ActionChain, Actions, bipLov) => {
  'use strict';

  // Add Class drawer, SUBCLASS list: the values of the MAPPED subclass column
  // found on the same items / assets as the picked class value -- the class
  // column is sent as P_PARENT_TYPE and the picked value as P_PARENT_ID. Empty
  // when the TYPE's mapping has no subclass column, or no class is picked yet.
  class loadSubclassLovChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const form = $page.variables.newClassSubclass || {};
      const source = String(form.trackingType || '').toUpperCase();
      const mapping = $page.functions.columnMappingFor($page.variables.ConfigSettingsMap, source);

      $page.variables.SubclassLovArray = [];
      $page.variables.subclassLovLoaded = false;
      if (!mapping || !mapping.subclassColumn || form.classLovId == null || form.classLovId === '') return;

      $page.variables.isSubclassLovLoading = true;
      try {
        const response = await Actions.callRest(context, {
          endpoint: 'bipService/runBIPReport',
          body: bipLov.buildSoapBody('/Custom/EquipRite/EQP_CATEGORY_LOV_RP.xdo', [
            { name: 'P_TRACKING_TYPE', value: source },
            { name: 'P_CATEGORY_TYPE', value: mapping.subclassColumn },
            { name: 'P_PARENT_TYPE',   value: mapping.classColumn },
            { name: 'P_PARENT_ID',     value: String(form.classLovId) }
          ])
        });
        $page.variables.SubclassLovArray = bipLov.decodeReportRows(
          response && response.body, 'G_1', 'LOV_ID', 'LOV_NAME', 'LOV_CODE')
          .map(r => ({ value: String(r.id), label: r.label || String(r.id), code: r.label2 }));
      } catch (e) {
        console.error('loadSubclassLovChain failed', e);
      } finally {
        $page.variables.isSubclassLovLoading = false;
        $page.variables.subclassLovLoaded = true;
      }
    }
  }

  return loadSubclassLovChain;
});
