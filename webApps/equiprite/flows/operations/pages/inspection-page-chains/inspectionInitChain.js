define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens Inspection: loads the queue, then the line from the URL (?lineId=) when one was passed.
  class inspectionInitChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      await Actions.callChain(context, { chain: 'loadQueueChain' });
      const lineId = Number($page.variables.lineId) || 0;
      if (lineId > 0) {
        await Actions.callChain(context, { chain: 'openLineChain', params: { lineId: String(lineId) } });
      }
    }
  }

  return inspectionInitChain;
});
