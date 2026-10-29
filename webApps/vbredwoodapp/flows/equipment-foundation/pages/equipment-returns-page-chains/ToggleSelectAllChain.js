define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class ToggleSelectAllChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const rows = $page.variables.PickingQueueFilteredArray || [];
      const selected = $page.variables.selectedIds || [];

      if (rows.length === 0) {
        $page.variables.selectedIds = [];
        return;
      }

      const allSelected = selected.length >= rows.length;
      $page.variables.selectedIds = allSelected ? [] : rows.map(r => r.id);
    }
  }

  return ToggleSelectAllChain;
});
