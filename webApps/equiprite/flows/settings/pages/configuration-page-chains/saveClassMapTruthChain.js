define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // From Old EquipRite flows/setup/pages/configurations-page-chains/saveClassMapTruthChain.js. ASSET
  // CLASSIFICATION SOURCE picked: saved at once as CLASS_MAPPING_SOURCE_OF_TRUTH through saveGlobalSettingNowChain.
  // Then a saved precedence is rewritten with the new source in the same rank (classMapPrecedenceForTruth) and saved
  // too, and a column-mapping form left on a source that is no longer allowed falls back to Inventory.
  // Two changes for New EquipRite, neither changes a write:
  //   - the picked value arrives as params.value (the old picker wrote ClassMapTruthSel through its binding);
  //   - the old chain set ClassMapPrecedenceSel and let that picker's value-changed event save it; there is no
  //     picker here, so saveClassMapPrecedenceChain is called directly at that point (same call, same order).
  class saveClassMapTruthChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      if (params && params.value !== undefined && params.value !== null) {
        if ($page.variables.isClassMapTruthSaving) return;
        $page.variables.ClassMapTruthSel = String(params.value);
      }
      const value = String($page.variables.ClassMapTruthSel || '');
      const entry = ($page.variables.ConfigSettingsMap || {}).CLASS_MAPPING_SOURCE_OF_TRUTH;

      $page.variables.isClassMapTruthSaving = true;
      try {
        const outcome = await Actions.callChain(context, {
          chain: 'saveGlobalSettingNowChain',
          params: {
            settingKey: 'CLASS_MAPPING_SOURCE_OF_TRUTH',
            settingValue: value,
            description: 'Asset classification source used by Class Mapping alongside Inventory (FIXED_ASSET / MAINTENANCE)'
          }
        });
        if (!outcome || !outcome.saved) return;

        const prec = String($page.variables.ClassMapPrecedenceSel || '');
        const nextPrec = $page.functions.classMapPrecedenceForTruth(prec, value);
        if (prec && nextPrec !== prec) {
          $page.variables.ClassMapPrecedenceSel = nextPrec;
          await Actions.callChain(context, { chain: 'saveClassMapPrecedenceChain' });
        }

        const draft = $page.variables.ColumnMapDraft || {};
        if (!$page.functions.isAllowedSource(draft.sourceType, value)) {
          $page.variables.ColumnMapDraft = { ...draft, sourceType: 'INVENTORY' };
          await Actions.callChain(context, { chain: 'onColumnMapSourceChangedChain' });
        }

        await Actions.fireNotificationEvent(context, {
          summary: 'Asset classification source saved',
          message: 'Class mappings now use Inventory and ' + $page.functions.fusionSourceLabel(value) + '.',
          displayMode: 'transient', type: 'confirmation'
        });
      } catch (e) {
        console.error('saveClassMapTruthChain failed', e);
        // Put the picker back to what is actually stored.
        $page.variables.ClassMapTruthSel = entry ? String(entry.settingValue || '') : '';
        await Actions.fireNotificationEvent(context, {
          summary: 'Asset classification source not saved',
          message: (e && e.message) || 'The setting could not be saved. Try again.',
          displayMode: 'transient', type: 'error'
        });
      } finally {
        $page.variables.isClassMapTruthSaving = false;
      }
    }
  }

  return saveClassMapTruthChain;
});
