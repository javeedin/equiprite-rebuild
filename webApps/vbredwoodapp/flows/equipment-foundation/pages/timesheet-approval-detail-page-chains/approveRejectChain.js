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

  class approveRejectChain extends ActionChain {
    async run(context, { status }) {
      const { $page } = context;
      
      // Update the header status variable
      $page.variables.headerStatus = status;

      // Show success message
      await Actions.fireNotificationEvent(context, {
        summary: status === 'APPROVED' ? 'Timesheet Approved' : 'Timesheet Rejected',
        message: status === 'APPROVED' ? 'The timesheet has been approved and moved to the next stage.' : 'The timesheet has been rejected and returned to the submitter.',
        displayMode: 'transient',
        type: 'success',
      });

      // Optionally navigate back after a delay
      // await Actions.navigateToPage(context, { page: 'timesheet-approvals' });
    }
  }

  return approveRejectChain;
});
