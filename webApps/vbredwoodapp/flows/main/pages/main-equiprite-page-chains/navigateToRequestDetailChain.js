define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class navigateToRequestDetailChain extends ActionChain {
    /**
     * @param {Object} context
     * @param {Object} params
     * @param {string} params.requestId        request NUMBER (e.g. "EQR-00042")
     * @param {number} params.requestNumericId numeric request id — required by the detail page's enriched lines endpoint
     */
    async run(context, params) {
      const requestId = params.requestId;
      const requestNumericId = params.requestNumericId;
      if (!requestId) {
        return;
      }

      await Actions.navigateToPage(context, {
        page: 'equipment-request-detail',
        params: {
          requestId: requestId,
          requestNumericId: requestNumericId,
          returnTo: 'main-equiprite',
          sourcePage: 'Equipment Requests'
        }
      });
    }
  }

  return navigateToRequestDetailChain;
});
