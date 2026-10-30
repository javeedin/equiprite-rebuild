define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/agreementRules',
  'resources/js/shellBus',
], (ActionChain, Actions, A, bus) => {
  'use strict';

  // Approve: New EquipRite's approveAgreementChain (the old one): FULL access; the header id must be known; an
  // agreement needs at least one line; PATCH /agreement-headers/{id} { status: ACTIVE }. Then, in Next, the agreement is
  // read again in its tab (the status as saved) instead of going back to the list. A failure stays on the page.
  class approveChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      const av = $application.variables;
      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RENTAL_AGREEMENTS') !== 'FULL') return;
      if (!A.canDecide(v.agreementStatus) || v.busy) return;
      const headerId = v.agreementHeaderId;

      if (!headerId) {
        this.say(v, 'The agreement\'s id could not be found. Refresh and try again.', 'error');
        return;
      }
      if (!Array.isArray(v.linesArray) || v.linesArray.length === 0) {
        this.say(v, 'This agreement has no lines. Add at least one line before approving it.', 'error');
        return;
      }

      v.busy = true;
      try {
        const result = await Actions.callRest(context, {
          endpoint:  'eqp-v1/patchAgreementHeader',
          uriParams: { id: headerId },
          body:      { status: 'ACTIVE' }
        });
        if (!result || !result.ok) {
          const detail = (result && result.body && JSON.stringify(result.body)) || 'No response from the server.';
          this.say(v, 'The agreement could not be approved (HTTP ' + (result && result.status) + '). ' + detail, 'error');
          return;
        }
        await Actions.callChain(context, { chain: 'viewLoadChain' });
        this.say(v, v.agreementNumber + ' is approved and active: its lines can be requested now.', 'info');
      } finally {
        v.busy = false;
      }
    }

    say(v, message, tone) {
      v.note = message;
      v.noteTone = tone;
      bus.toast(message, tone);
    }
  }

  return approveChain;
});
