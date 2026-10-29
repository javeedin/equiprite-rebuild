define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class closeAppMessageChain extends ActionChain {
    async run(context, { event }) {
      const { $page } = context;
      const closed = event && event.detail && event.detail.message;
      if (!closed) return;

      $page.variables.messagesArray = ($page.variables.messagesArray || [])
        .filter(m => m._msgId !== closed._msgId);
    }
  }

  return closeAppMessageChain;
});
