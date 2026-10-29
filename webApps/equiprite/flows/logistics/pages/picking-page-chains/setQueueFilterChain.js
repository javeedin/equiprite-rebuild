define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Search text and chip for the queue (replaces the old page's smart search, FilterPickingQueueChain; the
  // keyword rule itself is in picking-page.js queueRows). Display only: no call.
  class setQueueFilterChain extends ActionChain {
    async run(context, { text, chip }) {
      const { $page } = context;
      if (text !== undefined && text !== null) {
        $page.variables.queueText = String(text);
      }
      if (chip) {
        $page.variables.queueChip = String(chip);
      }
    }
  }

  return setQueueFilterChain;
});
