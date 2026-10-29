define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Search text and class chip for the returns queue (replaces the old page's smart search with its Class
  // filter, FilterPickingQueueChain; the rule is in receipt-page.js queueRows). Display only: no call.
  class setQueueFilterChain extends ActionChain {
    async run(context, { text, cls }) {
      const { $page } = context;
      if (text !== undefined && text !== null) {
        $page.variables.queueText = String(text);
      }
      if (cls) {
        $page.variables.queueClass = String(cls);
      }
    }
  }

  return setQueueFilterChain;
});
