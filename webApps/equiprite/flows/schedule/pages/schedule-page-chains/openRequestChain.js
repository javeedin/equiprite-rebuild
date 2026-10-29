define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A booking's request opens New EquipRite's Request detail (same parameters as Home's openRowChain).
  class openRequestChain extends ActionChain {
    async run(context, { requestId, requestNumber }) {
      if (requestId == null || requestId === '' || isNaN(Number(requestId))) {
        return;
      }
      await Actions.navigateToFlow(context, {
        flow: 'request',
        page: 'request-detail',
        target: 'parent',
        params: { requestId: String(requestNumber || ''), requestNumericId: Number(requestId) },
      });
    }
  }

  return openRequestChain;
});
