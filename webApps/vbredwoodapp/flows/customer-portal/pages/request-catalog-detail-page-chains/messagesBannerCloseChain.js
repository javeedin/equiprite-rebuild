define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (ActionChain, Actions) => {
  'use strict';

  class messagesBannerCloseChain extends ActionChain {
    async run(context) {
      const { $page, $chain } = context;
      const messageId = $chain.variables.messageId;
      $page.variables.messagesBannerArray = $page.variables.messagesBannerArray.filter(
        function(msg) { return msg.id !== messageId; }
      );
    }
  }

  return messagesBannerCloseChain;
});
