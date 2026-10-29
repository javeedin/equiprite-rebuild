define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/bipLov',
], (ActionChain, Actions, bipLov) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/loadClassLovChain.js, unchanged.

  // Add Class drawer, CLASS list: the distinct values of the Fusion column
  // MAPPED as the class column for the drawer's TYPE on the Class Mapping
  // sub-tab (CLASS_MAPPING_COLUMNS_<TYPE>), read from EQP_CATEGORY_LOV_RP.
  // No mapping for the TYPE -> nothing to list; the placeholder says so.
  class loadClassLovChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const source = String(($page.variables.newClassSubclass || {}).trackingType || '').toUpperCase();
      const mapping = $page.functions.columnMappingFor($page.variables.ConfigSettingsMap, source);

      $page.variables.ClassLovArray = [];
      $page.variables.classLovLoaded = false;
      // CUSTOM is typed by hand: there is no list to load.
      if (source === 'CUSTOM') return;
      if (!mapping) {
        $page.variables.classLovLoaded = true;
        return;
      }

      $page.variables.isClassLovLoading = true;
      try {
        const response = await Actions.callRest(context, {
          endpoint: 'bipService/runBIPReport',
          body: bipLov.buildSoapBody('/Custom/EquipRite/EQP_CATEGORY_LOV_RP.xdo', [
            { name: 'P_TRACKING_TYPE', value: source },
            { name: 'P_CATEGORY_TYPE', value: mapping.classColumn },
            // 'NONE', not empty: BIP binds empty as NULL, which matches no branch.
            { name: 'P_PARENT_TYPE',   value: 'NONE' },
            { name: 'P_PARENT_ID',     value: '' }
          ])
        });
        // value = the column value (stored as FUSION_CLASS_REF), label = its
        // display name, code = native code where the column has one.
        $page.variables.ClassLovArray = bipLov.decodeReportRows(
          response && response.body, 'G_1', 'LOV_ID', 'LOV_NAME', 'LOV_CODE')
          .map(r => ({ value: String(r.id), label: r.label || String(r.id), code: r.label2 }));
      } catch (e) {
        console.error('loadClassLovChain failed', e);
      } finally {
        $page.variables.isClassLovLoading = false;
        $page.variables.classLovLoaded = true;
      }
    }
  }

  return loadClassLovChain;
});
