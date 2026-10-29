define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Save the BU Settings drawer (create or edit a BU's settings).
  //
  // EQR_CONF_EQUIPMENT_SETTING is COLUMNAR: one row per BU, each setting a typed
  // column. So a save is ONE write, not the old per-key fan-out (which POSTed a
  // settingKey/settingValue body per key against a table with neither column —
  // producing duplicate rows with every typed column null).
  //   - BU already has a row (its id is __rowId on the loaded display row) → PATCH.
  //   - otherwise → POST a new row.
  //
  // esDraftToBody maps the draft to the camelCase columns with type coercion
  // (bool → 'Y'/'N', number|null, string|null). The 5 BU denorm columns ride along
  // via draft.buAttrs (resolved from Fusion on BU pick / edit-open).
  class saveEsDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const draft = $page.variables.EsDraft || {};
      const buId = draft.buId;

      if (buId == null) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Business Unit required',
          message: 'Please select a business unit.',
          displayMode: 'transient', type: 'warning'
        });
        return;
      }

      // Rate Source is a required choice — EquipRite or PPM, never blank. It is
      // half of the rate-source hierarchy (see usesPpmRates in app-flow.js).
      if (draft.RATE_SOURCE !== 'EQUIPRITE_RATES' && draft.RATE_SOURCE !== 'PPM_RATES') {
        await Actions.fireNotificationEvent(context, {
          summary: 'Rate Source required',
          message: 'Choose EquipRite Rates or PPM Rates for this business unit.',
          displayMode: 'transient', type: 'warning'
        });
        return;
      }

      // The BU's loaded display row carries the columnar row id (__rowId).
      const existingRow = ($page.variables.EsSettingsByBuArray || [])
        .find(function (r) { return String(r.buId) === String(buId); });
      const rowId = existingRow && existingRow.__rowId != null ? existingRow.__rowId : null;

      // BU denorm columns. Null means the Fusion lookup failed — spreading nothing
      // leaves the stored columns alone rather than blanking them. A resolved
      // buAttrs may carry a real null id (Fusion's ManagerId often is).
      const buAttrs = draft.buAttrs || {};

      // The typed setting columns, coerced to their storage types.
      const columns = $page.functions.esDraftToBody(draft);

      $page.variables.isEsSaving = true;
      let ok = false;
      try {
        let res;
        if (rowId != null) {
          res = await Actions.callRest(context, {
            endpoint: 'eqp-v1/patchConfEquipmentSettingsById',
            uriParams: { id: rowId },
            body: Object.assign({}, columns, buAttrs, { lastUpdatedBy: 'EQUIPRITE' })
          });
        } else {
          // New columnar row. CREATED_BY/LAST_UPDATED_BY are NOT NULL and not
          // backend-populated on insert (same gap as saveChangesChain).
          res = await Actions.callRest(context, {
            endpoint: 'eqp-v1/postConfEquipmentSettings',
            body: Object.assign({
              businessUnitId: Number(buId),
              isActiveFlag: 'Y',
              createdBy: 'EQUIPRITE',
              lastUpdatedBy: 'EQUIPRITE'
            }, columns, buAttrs)
          });
        }
        ok = !!(res && res.ok);
        if (!ok) console.error('saveEsDrawerChain: save failed', res && res.statusCode);
      } catch (e) {
        console.error('saveEsDrawerChain: exception saving BU', buId, e);
      }

      $page.variables.isEsSaving = false;

      if (ok) {
        $page.variables.isEsDrawerOpen = false;
        // Reload so the table reflects the saved columns + the row id.
        await Actions.callChain(context, { chain: 'loadEsSettingsChain' });
        await Actions.fireNotificationEvent(context, {
          summary: 'Settings saved',
          message: 'Equipment settings for "' + (draft.buName || buId) + '" were updated.',
          displayMode: 'transient', type: 'confirmation'
        });
      } else {
        await Actions.fireNotificationEvent(context, {
          summary: 'Could not save settings',
          message: 'Saving the settings for this business unit failed. Please try again.',
          displayMode: 'transient', type: 'error'
        });
      }
    }
  }

  return saveEsDrawerChain;
});
