define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // ASSET CLASSIFICATION SOURCE changed on the Class Mapping sub-tab: saved
  // immediately as CLASS_MAPPING_SOURCE_OF_TRUTH (saveGlobalSettingNowChain --
  // this tab has no Save Changes button).
  //
  // Then, if the source picked in the column-mapping form is no longer allowed,
  // fall back to Inventory so the form never holds a source the picker cannot show.
  // A saved precedence names the asset source, so it is rewritten with the new
  // one in the same rank (classMapPrecedenceForTruth) and saved too.
  class saveClassMapTruthChain extends ActionChain {
    async run(context) {
      const { $page } = context;
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
          // Setting the bound value fires the picker's value-changed, which
          // saves it through saveClassMapPrecedenceChain -- not called here as
          // well, or the same value would be saved twice.
          $page.variables.ClassMapPrecedenceSel = nextPrec;
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
