define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class openRequestChain extends ActionChain {
    async run(context, { row }) {
      if (!row || row.eqrEquipmentRequestId == null) {
        return;
      }
      await Actions.navigateToPage(context, {
        page: 'request-detail',
        params: { requestId: String(row.requestNumber || ''), requestNumericId: Number(row.eqrEquipmentRequestId) },
      });
    }
  }

  return openRequestChain;
});
