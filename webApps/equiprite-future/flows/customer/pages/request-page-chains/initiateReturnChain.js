define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser',
  'resources/js/portalView',
  'resources/js/portalSignal',
  'resources/js/requestData',
], (ActionChain, Actions, lineBody, cu, V, signal, requestData) => {
  'use strict';

  // The customer starts a return: DEPLOYED → RETURN_INITIATED. New EquipRite's customer initiateReturnChain (Old's,
  // copied unchanged), with the same calls, bodies and order:
  //   1 the pool (the ticked pieces, or all of them); of those, DEPLOYED only (New's isReturnable stamp)
  //   2 ONE batch PATCH equipment-requests/{id}/lines/batch, all or nothing
  //   3 GET equipment-requests/{id}/lines (size 2000), and when every line is terminal (CLOSED, REJECTED or CONSUMED)
  //     with at least one CLOSED or CONSUMED: PATCH the header CLOSED
  //   4 the request read again
  const SOURCE_STATE = 'DEPLOYED';
  const TARGET_STATE = 'RETURN_INITIATED';
  const CLOSE_TERMINAL_STATES = ['CLOSED', 'REJECTED', 'CONSUMED'];

  class initiateReturnChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      if (v.busy) return;
      const numericId = v.requestId;
      v.ask = {};
      if (!numericId) {
        v.banner = { type: 'error', text: 'Request ID not available. Please reload the page.', link: '' };
        return;
      }
      const selected = V.ticked(v.lines, v.ticks);
      const pool = selected.length > 0 ? selected : (v.lines || []).slice();
      const eligible = pool.filter((l) => [SOURCE_STATE].indexOf(l.lineStatus) !== -1);
      const skipped = pool.length - eligible.length;
      if (eligible.length === 0) {
        v.banner = { type: 'info', text: 'Nothing to return: none of these pieces is on your site.', link: '' };
        return;
      }

      v.busy = 'return';
      let done = false;
      try {
        const batch = await lineBody.updateLines(context, Actions, {
          requestId: numericId,
          headers: cu.auditHeaders(context),
          updates: eligible.map((l) => ({ id: Number(l.lineId), lineStatus: TARGET_STATE })),
          labels: eligible.map((l) => l.equipmentName),
        });
        if (!batch.ok) {
          v.banner = { type: 'error', text: 'The return was not started: ' + batch.message + ' No line was changed.', link: '' };
          return;
        }

        const verifyResult = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
          uriParams: { requestId: numericId, size: 2000 },
        });
        let headerClosed = false;
        if (verifyResult.ok && verifyResult.body && Array.isArray(verifyResult.body.data)) {
          const lines = verifyResult.body.data;
          const allTerminal = lines.length > 0
            && lines.every((l) => CLOSE_TERMINAL_STATES.indexOf(l.lineStatus) !== -1)
            && lines.some((l) => l.lineStatus === 'CLOSED' || l.lineStatus === 'CONSUMED');
          if (allTerminal) {
            const headerPatch = await Actions.callRest(context, {
              endpoint: 'eqp-v1/patchEquipmentRequest',
              uriParams: { id: numericId },
              body: { status: 'CLOSED' },
            });
            if (headerPatch.ok) headerClosed = true;
            else console.warn('[customer initiateReturnChain] header CLOSED PATCH failed:', headerPatch.status);
          }
        }

        const n = eligible.length;
        let message = 'The return of ' + n + (n === 1 ? ' piece has' : ' pieces has') + ' started: we collect ' + (n === 1 ? 'it' : 'them') + ' from your site.';
        if (skipped > 0) message += ' ' + skipped + (skipped === 1 ? ' other piece was' : ' other pieces were') + ' left as ' + (skipped === 1 ? 'it was' : 'they were') + '.';
        if (headerClosed) message += ' The request is closed.';
        v.banner = { type: 'confirmation', text: message, link: '' };
        v.ticks = {};
        done = true;
        signal.changed();
        requestData.invalidate();
      } finally {
        v.busy = '';
      }
      if (done) await Actions.callChain(context, { chain: 'loadRecordChain', params: { keepBanner: true } });
    }
  }

  return initiateReturnChain;
});
