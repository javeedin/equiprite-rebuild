define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Approve: the old rental-agreement-lines-page-chains/approveAgreementChain.js (an agreement needs a line; PATCH
  // /agreement-headers/{id} { status: ACTIVE }; back to the list). Changes: FULL access is checked (the old page had
  // no check), the list page is this flow's agreements, the notice names the agreement number.
  class approveAgreementChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const av = $application.variables;
      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RENTAL_AGREEMENTS') !== 'FULL') return;
      const headerId = $page.variables.agreementHeaderId;

      if (!headerId) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Cannot Approve',
          message: 'Agreement ID could not be resolved. Please reload the page.',
          displayMode: 'transient',
          type: 'error'
        });
        return;
      }

      // An agreement must have at least one equipment line before it can be
      // approved/activated. Block approval of an empty agreement.
      if (!Array.isArray($page.variables.linesArray) || $page.variables.linesArray.length === 0) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Cannot Approve',
          message: 'This agreement has no equipment lines. Add at least one line before approving.',
          displayMode: 'transient',
          type: 'error'
        });
        return;
      }

      console.log('[approve-agreement] patching headerId=', headerId, 'status=ACTIVE');

      const result = await Actions.callRest(context, {
        endpoint:  'eqp-v1/patchAgreementHeader',
        uriParams: { id: headerId },
        body:      { status: 'ACTIVE' }
      });

      console.log('[approve-agreement] result:', JSON.stringify({ ok: result && result.ok, status: result && result.status, body: result && result.body }));

      if (!result || !result.ok) {
        const detail = (result && result.body && JSON.stringify(result.body)) || 'No response from server.';
        await Actions.fireNotificationEvent(context, {
          summary: 'Approve Failed',
          message: 'Could not approve the agreement. ' + detail,
          displayMode: 'transient',
          type: 'error'
        });
        return;
      }

      await Actions.fireNotificationEvent(context, {
        summary: 'Agreement Approved',
        message: $page.variables.agreementNumber + ' has been approved.',
        displayMode: 'transient',
        type: 'confirmation'
      });

      await Actions.navigateToPage(context, {
        page:    'agreements',
        history: 'replace'
      });
    }
  }

  return approveAgreementChain;
});
