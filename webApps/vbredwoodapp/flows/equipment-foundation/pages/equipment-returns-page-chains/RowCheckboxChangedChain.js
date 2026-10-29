define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class RowCheckboxChangedChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;

      const checkboxEl = event.target;
      const requestId  = checkboxEl.id.replace('chk-', '');
      const isChecked  = checkboxEl.checked;

      const current = [...$page.variables.selectedIds];

      if (isChecked) {
        if (!current.includes(requestId)) {
          $page.variables.selectedIds = [...current, requestId];
        }
      } else {
        $page.variables.selectedIds = current.filter(id => id !== requestId);
      }
    }
  }

  return RowCheckboxChangedChain;
});
