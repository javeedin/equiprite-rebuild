define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A tick box on a returned line, or the header box (lineId 'all'). The old page bound the page module's
  // onLineRowCheckboxChanged / onLineHeaderCheckboxChanged to the grid cells and then ran
  // LineSelectionChangedChain (copied unchanged) to update the Receive button; same here.
  class toggleLineChain extends ActionChain {
    async run(context, { lineId, checked }) {
      const { $page } = context;
      if (lineId === 'all') {
        $page.functions.toggleAllLines();
      } else if (lineId !== undefined && lineId !== null && lineId !== '') {
        $page.functions.toggleLine(lineId, checked === true || checked === 'true');
      }
      await Actions.callChain(context, { chain: 'LineSelectionChangedChain' });
    }
  }

  return toggleLineChain;
});
