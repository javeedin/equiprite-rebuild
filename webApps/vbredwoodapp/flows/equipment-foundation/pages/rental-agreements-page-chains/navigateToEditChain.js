define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class navigateToEditChain extends ActionChain {

    /**
     * @param {Object} context
     * @param {Object} params
     */
    async run(context, { agreementId, statusCode }) {
      console.log('--- navigateToEditChain triggered for ID:', agreementId, 'status:', statusCode);

      if (statusCode === 'ACTIVE' || statusCode === 'REJECTED' || statusCode === 'EXPIRED') {
        await Actions.fireNotificationEvent(context, {
          summary: 'Cannot Edit',
          message: 'This agreement is ' + statusCode.charAt(0) + statusCode.slice(1).toLowerCase() + ' and cannot be edited.',
          displayMode: 'transient',
          type: 'error'
        });
        return;
      }

      await Actions.navigateToPage(context, {
        page: 'rental-agreement-create',
        params: {
          agreementId: agreementId
        }
      });
    }
  }

  return navigateToEditChain;
});
