define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Customer cancels a DRAFT or SUBMITTED request.
   * In production: call cancelRequest REST endpoint, then navigate back.
   */
  class CancelRequestChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const updated = Object.assign({}, $page.variables.requestDetail, { status: 'CLOSED' });
      $page.variables.requestDetail = updated;
      $page.variables.pageActions   = $page.functions.buildPageActions('CLOSED');

      await Actions.fireCustomEvent(context, {
        name: 'spShowToast',
        payload: { message: `${updated.requestNumber} has been cancelled.` }
      });

      // Navigate back to list after a brief moment so the toast is visible
      await Actions.navigateToPage(context, { page: 'customer-my-requests' });
    }
  }

  return CancelRequestChain;
});

