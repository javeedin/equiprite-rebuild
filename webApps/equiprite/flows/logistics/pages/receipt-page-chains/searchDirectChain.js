define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The Direct Return search box: Enter in it, or the Search button. A barcode gun types the label and sends
  // Enter, so Enter searches at once. Runs the old page's DirectReturnSearchChain (copied unchanged), which reads
  // directReturnQuery.
  //
  // Enter is taken from the keydown, with the box's own text: the old dialog listened for oj-input-text's
  // ojValueAction, which this JET version never fires (Enter only committed the value), and on keydown the
  // two-way binding has not written directReturnQuery yet. Other keys do nothing here.
  class searchDirectChain extends ActionChain {
    async run(context, { value, key }) {
      const { $page } = context;
      if (key !== undefined && key !== null && key !== 'Enter') {
        return;
      }
      if (value !== undefined && value !== null) {
        $page.variables.directReturnQuery = String(value);
      }
      await Actions.callChain(context, { chain: 'DirectReturnSearchChain' });
    }
  }

  return searchDirectChain;
});
