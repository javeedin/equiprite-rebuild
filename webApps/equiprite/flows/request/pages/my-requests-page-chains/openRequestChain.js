define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A request's number (on a card or an equipment row): New EquipRite's Request detail.
  class openRequestChain extends ActionChain {
    async run(context, { id, number }) {
      if (id === undefined || id === null || id === '') {
        return;
      }
      await Actions.navigateToPage(context, {
        page: 'request-detail',
        params: { requestId: String(number || ''), requestNumericId: Number(id) },
      });
    }
  }

  return openRequestChain;
});
