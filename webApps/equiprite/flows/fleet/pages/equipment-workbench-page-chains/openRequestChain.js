define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // The request a unit is on: New EquipRite's Request detail.
  class openRequestChain extends ActionChain {
    async run(context, { id, number }) {
      if (id === undefined || id === null || id === '') return;
      await Actions.navigateToFlow(context, {
        flow: 'request', page: 'request-detail', target: 'parent',
        params: { requestId: String(number || ''), requestNumericId: Number(id) },
      });
    }
  }

  return openRequestChain;
});
