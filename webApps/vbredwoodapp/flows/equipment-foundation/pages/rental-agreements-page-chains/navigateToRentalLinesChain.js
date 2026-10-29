define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
], (
  ActionChain,
  Actions,
  ActionUtils
) => {
  'use strict';

  class navigateToRentalLinesChain extends ActionChain {
    async run(context, { requestId }) {
      const { $page } = context;
      
      if (!requestId) {
        // If it's a row selection but without data yet, just open drawer
        $page.variables.isDrawerOpen = true;
        // In real app we would set selectedRequest here
        return;
      }

      await Actions.navigateToPage(context, {
        page: 'rental-agreement-lines',
        params: {
          requestId: requestId,
        },
      });
    }
  }

  return navigateToRentalLinesChain;
});
