define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Pencil (edit) on a BU row: pre-fill the drawer in EDIT mode from the loaded
  // per-BU settings row, build that BU's Inv Org LOV, then open the drawer.
  class openEsEditChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const { buId } = params || {};
      if (buId == null) return;

      const rows = $page.variables.EsSettingsByBuArray || [];
      const row = rows.find(function (r) { return String(r.buId) === String(buId); });
      if (!row) return;

      // BU denorm columns, refreshed from Fusion on open so a name/ledger change
      // upstream flows into the row on the next save.
      let buAttrs = null;
      try {
        const buRes = await Actions.callRest(context, {
          endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05FinBusinessUnitsLOV',
          uriParams: { q: 'BusinessUnitId=' + buId, limit: 1 }
        });
        if (buRes.ok) {
          buAttrs = $page.functions.mapFusionBuAttrs((buRes.body.items || [])[0]);
        }
      } catch (e) {
        console.error('openEsEditChain: BU lookup failed', e);
      }
      if (!buAttrs) {
        console.warn('openEsEditChain: no Fusion row for BU', buId,
          '— its BU columns will be left as stored');
      }

      // row values are already normalized by buildSettingsByBu; toBool is defensive.
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
        // Pass Procurement Cost (V2 §3): Yes → base cost = PO price; No →
        // ignore PO, use the EquipRite rate schedule. The markup that rides on
        // the Yes case is authored just below, on this same BU row.
        PASS_PROCUREMENT_COST:   toBool(row.PASS_PROCUREMENT_COST),
        ADHOC_TIMESHEET_ENABLED: toBool(row.ADHOC_TIMESHEET_ENABLED),
        // Procurement markup, restored to BU authoring. MUST be seeded here: the key
        // is in esColumnMap, so esDraftToBody writes it into every save body — an
        // unseeded draft would send marginPercentage:null and blank the stored
        // percent that both post-cost views price markup from.
        // buildSettingsByBu already ran it through esParseNum, so a genuine null
        // stays null rather than collapsing to Number('') === 0.
        MARGIN_PERCENTAGE:       (row.MARGIN_PERCENTAGE != null ? Number(row.MARGIN_PERCENTAGE) : null)
        // IS_SHIP_DOCUMENT intentionally not read into the draft — the field is gone
        // from the drawer and must stay out of the save body (see esColumnMap).
      };

      $page.variables.isEsDrawerOpen = true;
    }
  }

  return openEsEditChain;
});
