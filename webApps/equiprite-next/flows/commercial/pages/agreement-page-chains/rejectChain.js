define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/agreementRules',
  'resources/js/shellBus',
], (ActionChain, Actions, A, bus) => {
  'use strict';

  // Reject: New EquipRite's rejectAgreementChain (the old one): FULL access; it asks first (a rejected agreement
  // cannot be edited or approved again); PATCH /agreement-headers/{id} { status: REJECTED }. Then the agreement is read
  // again in its tab. A failure stays on the page.
  class rejectChain extends ActionChain {
    async run(context, params) {
      const { $page, $application } = context;
      const v = $page.variables;
      const av = $application.variables;
      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RENTAL_AGREEMENTS') !== 'FULL') return;
      if (!A.canDecide(v.agreementStatus) || v.busy) return;
      const headerId = v.agreementHeaderId;
      if (headerId && !(params && params.confirmed)) {
        v.ask = { kind: 'reject', title: 'Reject ' + v.agreementNumber + '?',
          message: 'A rejected agreement cannot be edited or approved again, and its lines cannot be requested.',
          ok: 'Reject the agreement' };
        return;
      }
      v.ask = null;

      if (!headerId) {
        this.say(v, 'The agreement\'s id could not be found. Refresh and try again.', 'error');
        return;
      }

      v.busy = true;
      try {
        const result = await Actions.callRest(context, {
          endpoint:  'eqp-v1/patchAgreementHeader',
          uriParams: { id: headerId },
          body:      { status: 'REJECTED' }
        });
        if (!result || !result.ok) {
          const detail = (result && result.body && JSON.stringify(result.body)) || 'No response from the server.';
          this.say(v, 'The agreement could not be rejected (HTTP ' + (result && result.status) + '). ' + detail, 'error');
          return;
        }
        await Actions.callChain(context, { chain: 'viewLoadChain' });
        this.say(v, v.agreementNumber + ' is rejected.', 'warning');
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

  return rejectChain;
});
