define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // BU Settings tab loader. Fetches ALL conf-equipment-settings (no
  // businessUnitId → every BU's rows in one call), pivots them into one row per
  // BU via buildSettingsByBu, then resolves Fusion BU names onto the rows (the DB
  // stores ids only — same lean-DB pattern as loadBuOrgMappingsChain).
  class loadEsSettingsChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      // pageSize/limit override — the endpoint defaults to pageSize=20 and silently
      // truncates once total settings exceed that (confirmed via network trace).
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
          }
        } catch (e) {
          console.error('loadEsSettingsChain: BU name lookup failed', e);
        }

        rows = rows.map(function (r) {
          return Object.assign({}, r, {
            buName: buNameById[String(r.buId)] || r.buName || String(r.buId)
          });
        });
      }

      $page.variables.EsSettingsByBuArray = rows;
    }
  }

  return loadEsSettingsChain;
});
