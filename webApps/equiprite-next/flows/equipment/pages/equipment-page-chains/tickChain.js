define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Tick boxes: one row (toggleRowSelection) or every selectable row on this page (setPageSelection). Import
  // merges exactly the ticked rows; a MERGED row cannot be ticked. Both return a new map (old page module).
  class tickChain extends ActionChain {
    async run(context, { index, checked }) {
      const { $page } = context;
      const v = $page.variables;
      if ($page.functions.isBusy(v)) return;
      const on = checked === true || checked === 'true';
      v.stagingSelectedRows = index === 'all'
        ? $page.functions.setPageSelection(on, v)
        : $page.functions.toggleRowSelection(Number(index), on, v);
    }
  }

  return tickChain;
});
