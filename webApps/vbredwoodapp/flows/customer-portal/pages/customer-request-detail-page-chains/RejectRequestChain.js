define([
  'vb/action/actionChain',
  'vb/action/actions'
], (ActionChain, Actions) => {
  'use strict';

  class RejectRequestChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const selectedCount = await $page.functions.getSelectedRowCount($page.variables.selection);

      const message = selectedCount > 0
        ? `${selectedCount} equipment line(s) have been rejected.`
        : 'The equipment request has been rejected.';

      await Actions.fireNotificationEvent(context, {
        summary: 'Request Rejected',
        message: message,
        displayMode: 'transient',
        type: 'warning'
      });
    }
  }

  return RejectRequestChain;
});
