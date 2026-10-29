define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Remove a source's column mapping: the setting is emptied (the row is kept,
  // so a later save PATCHes it). Classes already created from it are untouched.
  // params.source: the classification source.
  class removeColumnMappingChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;
      const source = params && params.source;
      if (!source) return;
      try {
        await Actions.callChain(context, {
          chain: 'saveGlobalSettingNowChain',
          params: { settingKey: $page.functions.columnMappingKey(source), settingValue: '' }
        });
        if (($page.variables.ColumnMapDraft || {}).sourceType === source) {
          await Actions.callChain(context, { chain: 'onColumnMapSourceChangedChain' });
        }
        await Actions.fireNotificationEvent(context, {
          summary: 'Column mapping removed',
          message: 'Removed the column mapping for ' + $page.functions.fusionSourceLabel(source)
            + '. Classes already created are kept.',
          displayMode: 'transient', type: 'confirmation'
        });
      } catch (e) {
        console.error('removeColumnMappingChain failed', e);
        await Actions.fireNotificationEvent(context, {
          summary: 'Column mapping not removed',
          message: (e && e.message) || 'The mapping could not be removed. Try again.',
          displayMode: 'transient', type: 'error'
        });
      }
    }
  }

  return removeColumnMappingChain;
});
