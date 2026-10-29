define([
  'vb/action/actionChain',
  'vb/action/actions'
], (ActionChain, Actions) => {
  'use strict';

  class confirmRequestChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const selectedCount = await $page.functions.getSelectedRowCount($page.variables.selection);

      const message = selectedCount > 0
        ? `${selectedCount} equipment line(s) have been successfully approved.`
        : 'The equipment request has been successfully approved.';

      await Actions.fireNotificationEvent(context, {
        summary: 'Request Approved',
        message: message,
        displayMode: 'transient',
        type: 'confirmation'
      });
    }
  }

  return confirmRequestChain;
});
