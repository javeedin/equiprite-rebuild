define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Customer confirms equipment received on site (status: SHIPPED → DEPLOYED).
   * In production: call updateRequestStatus REST endpoint, then navigate back.
   */
  class ReceiveRequestChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      // Update local state (replace with REST PATCH call in production)
      const updated = Object.assign({}, $page.variables.requestDetail, { status: 'DEPLOYED' });
      $page.variables.requestDetail = updated;
      $page.variables.pageActions   = $page.functions.buildPageActions('DEPLOYED');

      await Actions.fireCustomEvent(context, {
        name: 'spShowToast',
        payload: { message: `${updated.requestNumber} received on site. Status updated to On-Site.` }
      });
    }
  }

  return ReceiveRequestChain;
});
