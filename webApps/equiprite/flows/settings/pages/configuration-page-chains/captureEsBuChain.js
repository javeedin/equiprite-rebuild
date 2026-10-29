define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/captureEsBuChain.js, unchanged.

  // BU selected from the all-Fusion-BUs dropdown inside the Equipment Settings
  // drawer (EsBuLovSDP → finBusinessUnitsLOV). Fetch that BU's Fusion row for its
  // display name + the attributes every settings record denormalizes, then
  // pre-fill from the BU's existing settings row (if already configured).
  //
  // The row is fetched rather than read off the selection because
  // on-value-changed carries only the id.
  class captureEsBuChain extends ActionChain {
    async run(context, { buId } = {}) {
      const { $page } = context;
      const id = buId != null && buId !== '' ? Number(buId) : null;

      // buAttrs stays null when the lookup fails — the save chain reads that as
      // "unknown" and omits the columns rather than blanking them.
      let buAttrs = null;

      if (id != null) {
        try {
          const buRes = await Actions.callRest(context, {
            endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05FinBusinessUnitsLOV',
            uriParams: { q: 'BusinessUnitId=' + id, limit: 1 }
          });
          if (buRes.ok) {
            buAttrs = $page.functions.mapFusionBuAttrs((buRes.body.items || [])[0]);
          }
        } catch (e) {
          console.error('captureEsBuChain: BU lookup failed', e);
        }
        if (!buAttrs) {
          console.warn('captureEsBuChain: no Fusion row for BU', id,
            '— its BU columns will not be written');
        }
      }

      const name = (buAttrs && buAttrs.businessUnitName) || '';
      $page.variables.EsBuSelectedName = name;

      const existing = ($page.variables.EsSettingsByBuArray || [])
        .find(function (r) { return String(r.buId) === String(id); });

      // existing row values are already normalized by buildSettingsByBu (flags are
      // booleans, numbers a number|null); toBool is defensive.
      const toBool = function (v) { return v === true || v === 'Y' || v === 'true'; };

      $page.variables.EsDraft = {
        buId: id,
        buName: name,
        buAttrs: buAttrs,
        RATE_SOURCE:       existing ? (existing.RATE_SOURCE       || '') : '',
        PPM_TRANS_SOURCE:  existing ? (existing.PPM_TRANS_SOURCE  || '') : '',
        PPM_BATCH_PREFIX:  existing ? (existing.PPM_BATCH_PREFIX  || '') : '',
        PASS_PROCUREMENT_COST:   existing ? toBool(existing.PASS_PROCUREMENT_COST)   : false,
        ADHOC_TIMESHEET_ENABLED: existing ? toBool(existing.ADHOC_TIMESHEET_ENABLED) : false
        // IS_SHIP_DOCUMENT dropped: the Ship Doc switch is gone from this tab.
        // MARGIN_PERCENTAGE dropped: procurement markup is authored per equipment
        // subclass now, so it is neither drafted nor saved from this tab.
      };
    }
  }

  return captureEsBuChain;
});
