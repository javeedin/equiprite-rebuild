define([
  'vb/action/actionChain',
], function(ActionChain) {
  'use strict';

  // Select-all toggle for the preview dialog. Selects every AVAILABLE line; if
  // they are all already selected, clears the selection. Lines no longer in the
  // catalog (available === false) are never selectable.
  class CatalogPreviewSelectAllChain extends ActionChain {
    async run(context) {
      var $page = context.$page;
      var lines = $page.variables.previewLinesArray || [];

      var selectableIds = lines
        .filter(function(l) { return l.available; })
        .map(function(l) { return Number(l.equipmentMasterId); });

      var current = ($page.variables.previewSelectedKeys || []).map(Number);
      var allSelected = selectableIds.length > 0 &&
        selectableIds.every(function(id) { return current.indexOf(id) >= 0; });

      $page.variables.previewSelectedKeys  = allSelected ? [] : selectableIds;
      $page.variables.previewSelectionTick = ($page.variables.previewSelectionTick || 0) + 1;
    }
  }

  return CatalogPreviewSelectAllChain;
});
