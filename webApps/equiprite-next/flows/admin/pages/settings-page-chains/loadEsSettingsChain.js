define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/settingsKit',
], (ActionChain, Actions, kit) => {
  'use strict';

  // New EquipRite's loadEsSettingsChain (from Old's), with the same calls: every conf-equipment-settings row
  // (pageSize / limit 10000), pivoted into one row per business unit (buildSettingsByBu), the app's buRateSources
  // refreshed (the menu's Rates entry follows it), then the business-unit names from Fusion (finBusinessUnitsLOV, a
  // read). The stored name is kept on each row (buStoredName), as in New.
  class loadEsSettingsChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const result = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getConfEquipmentSettings',
        uriParams: { pageSize: 10000, limit: 10000 }
      });

      if (!result.ok) {
        console.error('loadEsSettingsChain: failed', result.statusCode);
        $page.variables.EsSettingsByBuArray = [];
        await Actions.callChain(context, { chain: 'applyChain' });
        return;
      }

      const data = (result.body && result.body.data) || [];
      let rows = kit.buildSettingsByBu(data);

      context.$application.variables.buRateSources =
        context.$application.functions.buRateSourceMap(data);

      if (rows.length) {
        const buNameById = {};
        try {
          const buRes = await Actions.callRest(context, {
            endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05FinBusinessUnitsLOV',
            uriParams: { fields: 'BusinessUnitId,BusinessUnitName', limit: 500 }
          });
          if (buRes.ok) {
            (buRes.body.items || []).forEach(function (b) {
              buNameById[String(b.BusinessUnitId)] = b.BusinessUnitName;
            });
            $page.variables.FusionBuList = buRes.body.items || [];
          }
        } catch (e) {
          console.error('loadEsSettingsChain: BU name lookup failed', e);
        }

        rows = rows.map(function (r) {
          return Object.assign({}, r, {
            buStoredName: r.buName,
            buName: buNameById[String(r.buId)] || r.buName || String(r.buId)
          });
        });
      }

      $page.variables.EsSettingsByBuArray = rows;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return loadEsSettingsChain;
});
