define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A line's tick box, or the header's (index 'all'). The selection lives in the page module (as on the old page);
  // onSelectionChangedChain then refreshes selectionState, which enables the action buttons.
  class toggleLineChain extends ActionChain {
    async run(context, { index, checked }) {
      const { $page } = context;
      if (index === 'all') {
        $page.functions.setAllSelected(!!checked);
      } else {
        $page.functions.setRowSelected(Number(index), !!checked);
      }
      await Actions.callChain(context, { chain: 'onSelectionChangedChain' });
    }
  }

  return toggleLineChain;
});
