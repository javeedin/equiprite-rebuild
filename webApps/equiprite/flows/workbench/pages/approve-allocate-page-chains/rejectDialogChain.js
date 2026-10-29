define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Reject asks first (it cannot be undone): open / close the dialog; confirm closes it and runs rejectRequestChain
  // (copied unchanged from Request detail).
  class rejectDialogChain extends ActionChain {
    async run(context, { action }) {
      if (action === 'open' || action === 'close' || action === 'confirm') {
        await Actions.callComponentMethod(context, {
          selector: '#rejectLinesDialog',
          method:   action === 'open' ? 'open' : 'close'
        });
      }
      if (action === 'confirm' && !context.$page.variables.isReadOnly) {
        await Actions.callChain(context, { chain: 'rejectRequestChain' });
      }
    }
  }

  return rejectDialogChain;
});
