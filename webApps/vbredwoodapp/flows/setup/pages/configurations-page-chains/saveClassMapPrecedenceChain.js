define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // SOURCE PRECEDENCE changed on the Class Mapping sub-tab: saved immediately as
  // CLASS_MAPPING_PRECEDENCE (saveGlobalSettingNowChain) -- the key and format
  // the item import's classify step reads (EQR_ITEM_IMPORT_MERGE_PKG): an
  // ordered, comma-separated source list, first = highest, e.g.
  // 'MAINTENANCE,INVENTORY'. Each imported item is classified from the FIRST
  // source in the list it has data in (no fall-through to the next source).
  // saveClassMapTruthChain keeps the list in step when the asset source changes.
  class saveClassMapPrecedenceChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const value = String($page.variables.ClassMapPrecedenceSel || '');
      const entry = ($page.variables.ConfigSettingsMap || {}).CLASS_MAPPING_PRECEDENCE;

      $page.variables.isClassMapPrecedenceSaving = true;
      try {
        const outcome = await Actions.callChain(context, {
          chain: 'saveGlobalSettingNowChain',
          params: {
            settingKey: 'CLASS_MAPPING_PRECEDENCE',
            settingValue: value,
            description: 'Class Mapping precedence: ordered sources (INVENTORY / MAINTENANCE / FIXED_ASSET). Each imported item is classified from the first source it has data in.'
          }
        });
        if (!outcome || !outcome.saved) return;

        await Actions.fireNotificationEvent(context, {
          summary: 'Source precedence saved',
          message: 'Items are classified from ' + $page.functions.classMapPrecedenceLabel(value) + '.',
          displayMode: 'transient', type: 'confirmation'
        });
      } catch (e) {
        console.error('saveClassMapPrecedenceChain failed', e);
        $page.variables.ClassMapPrecedenceSel = entry ? String(entry.settingValue || '') : '';
        await Actions.fireNotificationEvent(context, {
          summary: 'Source precedence not saved',
          message: (e && e.message) || 'The setting could not be saved. Try again.',
          displayMode: 'transient', type: 'error'
        });
      } finally {
        $page.variables.isClassMapPrecedenceSaving = false;
      }
    }
  }

  return saveClassMapPrecedenceChain;
});
