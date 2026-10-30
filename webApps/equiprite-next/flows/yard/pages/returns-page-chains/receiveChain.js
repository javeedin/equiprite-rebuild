define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rules',
], (ActionChain, Actions, rules) => {
  'use strict';

  // Receive at yard: New's receiveChain. A busy flag is set before any await, so a double click cannot send the batch
  // twice; then acceptReturnLinesChain (New's AcceptReturnLinesChain). Next adds: only a role with full access to
  // Receipt & returns may receive.
  class receiveChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      const v = context.$page.variables;
      if (v.busy) return;
      if (rules.pageAccess($application.variables.pageAccessMap, $application.variables.pageAccessLoaded, 'EQR_EQUIPMENT_RETURNS') !== 'FULL') {
        v.banner = { type: 'error', text: 'Your role cannot receive returns.' };
        return;
      }
      v.busy = 'receive';
      try {
        await Actions.callChain(context, { chain: 'acceptReturnLinesChain' });
      } catch (e) {
        console.error('[receiveChain] receive failed', e);
        v.banner = { type: 'error', text: 'Something went wrong (' + ((e && e.message) || e) + '). Some pieces may already be closed: '
          + 'Refresh to see where the request stands before trying again.' };
      } finally {
        try { v.busy = ''; } catch (e2) { /* page already left */ }
      }
    }
  }

  return receiveChain;
});
