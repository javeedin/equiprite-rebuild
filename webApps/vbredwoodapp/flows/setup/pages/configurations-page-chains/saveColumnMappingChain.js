define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Save the column mapping for one classification source: which Fusion column
  // holds the equipment CLASS and (optionally) which the SUBCLASS. Stored as a
  // global setting CLASS_MAPPING_COLUMNS_<SOURCE> (JSON) through
  // saveGlobalSettingNowChain -- one mapping per source; saving again replaces
  // it. The column NAMES are stored too, so the table reads well even before
  // the column list has loaded.
  class saveColumnMappingChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const d = $page.variables.ColumnMapDraft || {};
      const types = $page.variables.ClassMapTypesArray;
      const notify = (summary, message, type) =>
        Actions.fireNotificationEvent(context, { summary, message, type, displayMode: 'transient' });

      if (!d.sourceType || !d.classGroup || !d.classColumn) {
        await notify('Required information missing',
          'Select a classification source, and the field group and column that hold the class.', 'warning');
        return;
      }
      if ((d.subclassGroup && !d.subclassColumn) || (!d.subclassGroup && d.subclassColumn)) {
        await notify('Required information missing',
          'Select both the field group and the column for the subclass, or neither.', 'warning');
        return;
      }
      if (d.subclassColumn && d.subclassColumn === d.classColumn) {
        await notify('Same column twice', 'The class and the subclass must come from different columns.', 'warning');
        return;
      }

      const value = JSON.stringify({
        classGroup: d.classGroup,
        classColumn: d.classColumn,
        classColumnName: $page.functions.categoryTypeLabel(d.sourceType, d.classColumn, types),
        subclassGroup: d.subclassGroup || null,
        subclassColumn: d.subclassColumn || null,
        subclassColumnName: d.subclassColumn
          ? $page.functions.categoryTypeLabel(d.sourceType, d.subclassColumn, types) : null
      });

      $page.variables.isColumnMapSaving = true;
      try {
        await Actions.callChain(context, {
          chain: 'saveGlobalSettingNowChain',
          params: {
            settingKey: $page.functions.columnMappingKey(d.sourceType),
            settingValue: value,
            description: 'Class Mapping: the Fusion columns that hold the equipment class and subclass for '
              + $page.functions.fusionSourceLabel(d.sourceType)
          }
        });
        await notify('Column mapping saved',
          $page.functions.fusionSourceLabel(d.sourceType) + ' classes now come from '
            + $page.functions.categoryTypeLabel(d.sourceType, d.classColumn, types)
            + (d.subclassColumn ? ', subclasses from '
              + $page.functions.categoryTypeLabel(d.sourceType, d.subclassColumn, types) : '') + '.',
          'confirmation');
      } catch (e) {
        console.error('saveColumnMappingChain failed', e);
        await notify('Column mapping not saved', (e && e.message) || 'The mapping could not be saved. Try again.', 'error');
      } finally {
        $page.variables.isColumnMapSaving = false;
      }
    }
  }

  return saveColumnMappingChain;
});
