define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/settingsKit',
  'resources/js/shellBus',
], (ActionChain, Actions, kit, bus) => {
  'use strict';

  // New EquipRite's saveEsDrawerChain (from Old's): the same checks and the same single write per business unit —
  //   a business unit and a rate source (EquipRite or PPM) are required; the markup is 0 to 100 or empty;
  //   the row loaded for it (its __rowId) is PATCHed: eqp-v1/patchConfEquipmentSettingsById with the typed columns
  //   (esDraftToBody), the Fusion business-unit columns when known (buAttrs) and lastUpdatedBy 'EQUIPRITE';
  //   with no row yet it would be POSTed (Next edits only the business units already set up; adding one is New's);
  // then the rows are read again (loadEsSettingsChain), which refreshes the app's rate sources and so the menu.
  class saveEsDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const draft = $page.variables.EsDraft || {};
      const buId = draft.buId;
      if ($page.variables.readOnly || $page.variables.isEsSaving) return;

      if (buId == null) {
        bus.toast('Pick a business unit first.', 'warning');
        return;
      }

      if (draft.RATE_SOURCE !== 'EQUIPRITE_RATES' && draft.RATE_SOURCE !== 'PPM_RATES') {
        bus.toast('Choose EquipRite rates or PPM rates for this business unit: the rate source is required.', 'warning');
        return;
      }

      const markup = draft.MARGIN_PERCENTAGE;
      if (markup !== null && markup !== undefined && markup !== '' && (isNaN(Number(markup)) || Number(markup) < 0 || Number(markup) > 100)) {
        bus.toast('Enter a procurement markup from 0 to 100, or leave it empty.', 'warning');
        return;
      }

      const existingRow = ($page.variables.EsSettingsByBuArray || [])
        .find(function (r) { return String(r.buId) === String(buId); });
      const rowId = existingRow && existingRow.__rowId != null ? existingRow.__rowId : null;

      const buAttrs = draft.buAttrs || {};
      const columns = kit.esDraftToBody(draft);

      $page.variables.isEsSaving = true;
      let ok = false;
      let status = 0;
      try {
        let res;
        if (rowId != null) {
          res = await Actions.callRest(context, {
            endpoint: 'eqp-v1/patchConfEquipmentSettingsById',
            uriParams: { id: rowId },
            body: Object.assign({}, columns, buAttrs, { lastUpdatedBy: 'EQUIPRITE' })
          });
        } else {
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
        status = res ? res.status : 0;
        if (!ok) console.error('saveEsDrawerChain: save failed', res && res.statusCode);
      } catch (e) {
        console.error('saveEsDrawerChain: exception saving BU', buId, e);
      }

      $page.variables.isEsSaving = false;

      if (ok) {
        $page.variables.isEsDrawerOpen = false;
        await Actions.callChain(context, { chain: 'loadEsSettingsChain' });
        bus.toast('Saved the settings of ' + (draft.buName || buId) + '.', 'info');
      } else {
        bus.toast('The settings of ' + (draft.buName || buId) + ' were not saved' + (status ? ' (HTTP ' + status + ')' : '') + '. Nothing changed; try again.', 'error');
      }
    }
  }

  return saveEsDrawerChain;
});
