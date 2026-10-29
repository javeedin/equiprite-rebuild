define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class rejectAgreementChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const headerId = $page.variables.agreementHeaderId;

      if (!headerId) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Cannot Reject',
          message: 'Agreement ID could not be resolved. Please reload the page.',
          displayMode: 'transient',
          type: 'error'
        });
        return;
      }

      console.log('[reject-agreement] patching headerId=', headerId, 'status=REJECTED');

      const result = await Actions.callRest(context, {
        endpoint:  'eqp-v1/patchAgreementHeader',
        uriParams: { id: headerId },
        body:      { status: 'REJECTED' }
      });

      console.log('[reject-agreement] result:', JSON.stringify({ ok: result && result.ok, status: result && result.status, body: result && result.body }));

      if (!result || !result.ok) {
        const detail = (result && result.body && JSON.stringify(result.body)) || 'No response from server.';
        await Actions.fireNotificationEvent(context, {
          summary: 'Reject Failed',
          message: 'Could not reject the agreement. ' + detail,
          displayMode: 'transient',
          type: 'error'
        });
        return;
      }

      await Actions.fireNotificationEvent(context, {
        summary: 'Agreement Rejected',
        message: $page.variables.pageTitle + ' has been rejected.',
        displayMode: 'transient',
        type: 'warning'
      });

      await Actions.navigateToPage(context, {
        page:    'rental-agreements',
        history: 'replace'
      });
    }
  }

  return rejectAgreementChain;
});
