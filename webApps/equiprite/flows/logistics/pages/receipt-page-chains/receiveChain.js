define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Receive at yard: runs the old page's Accept, AcceptReturnLinesChain, copied unchanged (one batch PATCH
  // SHIPPED_TO_YARD -> CLOSED with the actual return date, then each unit back to stock, then the header
  // CLOSED when every line is finished). Added here, UI only: a busy flag set before any await, so a double
  // click cannot send the batch twice, and the button reads "Receiving…" meanwhile.
  class receiveChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      if ($page.variables.isAccepting) {
        return;
      }
      $page.variables.isAccepting = true;
      try {
        await Actions.callChain(context, { chain: 'AcceptReturnLinesChain' });
      } catch (e) {
        console.error('[receiveChain] receive failed', e);
        await Actions.fireNotificationEvent(context, {
          summary: 'Receipt interrupted',
          message: 'Something went wrong (' + ((e && e.message) || e) + '). Some lines may already be closed: '
            + 'reopen the request to see where it stands before trying again.',
          type: 'error',
          displayMode: 'persist',
        });
      } finally {
        try { $page.variables.isAccepting = false; } catch (e2) { /* page already left */ }
      }
    }
  }

  return receiveChain;
});
