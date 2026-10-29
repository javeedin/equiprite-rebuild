define([
  'vb/action/actionChain',
], function(ActionChain) {
  'use strict';

  // Toggle a single preview-line checkbox. Maintains previewSelectedKeys (the
  // set of selected equipment master ids) + bumps previewSelectionTick so the
  // native checkboxes re-sync. Selection lives ONLY in the preview dialog — it
  // does not touch the catalog's staging or the cart.
  class CatalogPreviewToggleChain extends ActionChain {
    async run(context, { checked, equipmentMasterId } = {}) {
      var $page = context.$page;
      var id = Number(equipmentMasterId);
      if (isNaN(id)) { return; }

      var keys = ($page.variables.previewSelectedKeys || []).slice();
      if (checked) {
        if (keys.indexOf(id) < 0) keys.push(id);
      } else {
        keys = keys.filter(function(k) { return Number(k) !== id; });
      }

      $page.variables.previewSelectedKeys  = keys;
      $page.variables.previewSelectionTick = ($page.variables.previewSelectionTick || 0) + 1;
    }
  }

  return CatalogPreviewToggleChain;
});
