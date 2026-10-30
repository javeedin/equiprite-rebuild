define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/settingsKit',
], (ActionChain, Actions, kit) => {
  'use strict';

  // New EquipRite's openEsEditChain (from Old's), unchanged but for where it opens: Edit on a business unit fills
  // the editor from its loaded row, after reading the business unit's columns from Fusion (finBusinessUnitsLOV
  // q=BusinessUnitId=, a read) so a name or ledger changed upstream goes into the row on the next save. Every
  // field of the save body is seeded here (MARGIN_PERCENTAGE too, or a save would blank the stored markup).
  class openEsEditChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { buId } = params || {};
      if (buId == null || $page.variables.readOnly) return;

      const rows = $page.variables.EsSettingsByBuArray || [];
      const row = rows.find(function (r) { return String(r.buId) === String(buId); });
      if (!row) return;

      let buAttrs = null;
      try {
        const buRes = await Actions.callRest(context, {
          endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05FinBusinessUnitsLOV',
          uriParams: { q: 'BusinessUnitId=' + buId, limit: 1 }
        });
        if (buRes.ok) {
          buAttrs = kit.mapFusionBuAttrs((buRes.body.items || [])[0]);
        }
      } catch (e) {
        console.error('openEsEditChain: BU lookup failed', e);
      }
      if (!buAttrs) {
        console.warn('openEsEditChain: no Fusion row for BU', buId,
          '— its BU columns will be left as stored');
      }

      const toBool = function (v) { return v === true || v === 'Y' || v === 'true'; };

      $page.variables.esIsEditMode = true;
      $page.variables.EsBuSelectedName = (buAttrs && buAttrs.businessUnitName)
        || row.buName || String(row.buId);
      $page.variables.EsDraft = {
        buId: row.buId,
        buName: (buAttrs && buAttrs.businessUnitName) || row.buName || String(row.buId),
        buAttrs: buAttrs,
        RATE_SOURCE:       row.RATE_SOURCE       || '',
        PPM_TRANS_SOURCE:  row.PPM_TRANS_SOURCE  || '',
        PPM_BATCH_PREFIX:  row.PPM_BATCH_PREFIX  || '',
        PASS_PROCUREMENT_COST:   toBool(row.PASS_PROCUREMENT_COST),
        ADHOC_TIMESHEET_ENABLED: toBool(row.ADHOC_TIMESHEET_ENABLED),
        MARGIN_PERCENTAGE:       (row.MARGIN_PERCENTAGE != null ? Number(row.MARGIN_PERCENTAGE) : null)
      };

      $page.variables.isEsDrawerOpen = true;
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return openEsEditChain;
});
