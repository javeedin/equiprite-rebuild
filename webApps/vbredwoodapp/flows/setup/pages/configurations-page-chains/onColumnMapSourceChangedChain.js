define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // CLASSIFICATION SOURCE changed in the column-mapping form (and on page load,
  // once the columns are loaded): fill the form from that source's SAVED
  // mapping so it reads as "edit", or start blank. A stale preview belongs to
  // whatever source it was run for, so it is cleared.
  class onColumnMapSourceChangedChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const draft = $page.variables.ColumnMapDraft || {};
      const saved = $page.functions.columnMappingFor($page.variables.ConfigSettingsMap, draft.sourceType);

      $page.variables.ColumnMapDraft = {
        sourceType: draft.sourceType,
        classGroup: saved ? saved.classGroup : null,
        classColumn: saved ? saved.classColumn : null,
        subclassGroup: saved ? (saved.subclassGroup || null) : null,
        subclassColumn: saved ? (saved.subclassColumn || null) : null
      };
      $page.variables.ClassMapPairsArray = [];
      $page.variables.ClassMapPairsSource = '';
    }
  }

  return onColumnMapSourceChangedChain;
});
