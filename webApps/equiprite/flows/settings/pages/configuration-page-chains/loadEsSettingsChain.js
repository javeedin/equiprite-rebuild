define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/loadEsSettingsChain.js. Same calls: all
  // conf-equipment-settings (pageSize / limit 10000), pivoted into one row per BU by buildSettingsByBu, the app-wide
  // buRateSources refreshed (the menu's Rate schedules entry follows it), then BU names from Fusion
  // (finBusinessUnitsLOV). New EquipRite keeps two things the old SDPs held: the stored BU name on each row
  // (buStoredName, what Business units & yards posts as buName) and the Fusion BU list (FusionBuList, the Add
  // picker).
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
        return;
      }

      const data = (result.body && result.body.data) || [];
      let rows = $page.functions.buildSettingsByBu(data);

      // Keep the app-wide rate-source map in step, so a Rate Source saved here
      // shows or hides Rate Management in this session without a reload.
      context.$application.variables.buRateSources =
        context.$application.functions.buRateSourceMap(data);

      if (rows.length) {
        // Resolve BU names from Fusion — one finBusinessUnitsLOV call for all BUs.
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
    }
  }

  return loadEsSettingsChain;
});
