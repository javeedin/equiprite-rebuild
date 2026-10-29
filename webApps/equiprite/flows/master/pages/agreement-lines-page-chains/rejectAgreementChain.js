define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Reject: the old rental-agreement-lines-page-chains/rejectAgreementChain.js (PATCH /agreement-headers/{id}
  // { status: REJECTED }; back to the list). Changes: FULL access is checked, it asks first on the page's question
  // card (rejecting cannot be undone here), the list page is this flow's agreements.
  class rejectAgreementChain extends ActionChain {
    async run(context, params) {
      const { $page, $application } = context;
      const av = $application.variables;
      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RENTAL_AGREEMENTS') !== 'FULL') return;
      const headerId = $page.variables.agreementHeaderId;
      if (headerId && !(params && params.confirmed)) {
        $page.variables.ask = { kind: 'reject', title: 'Reject ' + $page.variables.agreementNumber + '?',
          message: 'A rejected agreement cannot be edited or approved again, and its lines cannot be requested.',
          ok: 'Reject agreement' };
        return;
      }
      $page.variables.ask = null;

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
        message: $page.variables.agreementNumber + ' has been rejected.',
        displayMode: 'transient',
        type: 'warning'
      });

      await Actions.navigateToPage(context, {
        page:    'agreements',
        history: 'replace'
      });
    }
  }

  return rejectAgreementChain;
});
