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

  // The customer refuses a delivery: SHIP_TO_SITE → REJECTED (the customer copy: refused goes REJECTED, unlike the
  // project page's RETURN_INITIATED). New EquipRite's customer rejectDeliveryChain, with the same calls, bodies and
  // order: the pool (the ticked pieces, or all of them), ONE batch PATCH .../lines/batch, then the request read again.
  const SOURCE_STATE = 'SHIP_TO_SITE';
  const TARGET_STATE = 'REJECTED';

  class rejectDeliveryChain extends ActionChain {
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
      const eligible = pool.filter((l) => l.lineStatus === SOURCE_STATE);
      const skipped = pool.length - eligible.length;
      if (eligible.length === 0) {
        v.banner = { type: 'info', text: 'Nothing to refuse: none of these pieces is on its way to you.', link: '' };
        return;
      }

      v.busy = 'refuse';
      let done = false;
      try {
        const batch = await lineBody.updateLines(context, Actions, {
          requestId: numericId,
          headers: cu.auditHeaders(context),
          updates: eligible.map((l) => ({ id: Number(l.lineId), lineStatus: TARGET_STATE })),
          labels: eligible.map((l) => l.equipmentName),
        });
        if (!batch.ok) {
          v.banner = { type: 'error', text: 'Nothing was refused: ' + batch.message + ' No line was changed.', link: '' };
          return;
        }
        const n = eligible.length;
        let message = n + (n === 1 ? ' piece was' : ' pieces were') + ' refused. Your equipment manager is told, and arranges the rest with you.';
        if (skipped > 0) message += ' ' + skipped + (skipped === 1 ? ' other piece was' : ' other pieces were') + ' left as ' + (skipped === 1 ? 'it was' : 'they were') + '.';
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

  return rejectDeliveryChain;
});
