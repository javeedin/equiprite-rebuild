define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // A tick box on a line, or the header box (lineId 'all'). The old page bound the page module's
  // onRowCheckboxChanged / onHeaderCheckboxChanged straight to the grid cells; the ticks still live in the
  // page module (picking-page.js), which also keeps selectedTOId and selectionTick in step.
  class toggleLineChain extends ActionChain {
    async run(context, { lineId, checked }) {
      const { $page } = context;
      if (lineId === 'all') {
        $page.functions.toggleAll($page);
        return;
      }
      if (lineId === undefined || lineId === null || lineId === '') {
        return;
      }
      $page.functions.toggleLine(lineId, checked === true || checked === 'true', $page);
    }
  }

  return toggleLineChain;
});
