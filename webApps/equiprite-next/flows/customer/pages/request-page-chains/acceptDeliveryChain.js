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

  // The customer accepts a delivery: SHIP_TO_SITE → DEPLOYED (a consumable → DELIVERED, with its delivered quantity).
  // New EquipRite's customer acceptDeliveryChain (Old's, copied), with the same calls, bodies and order:
  //   1 the pool: the ticked pieces, or every piece when none is ticked; of those, the ones at SHIP_TO_SITE
  //   2 ONE batch PATCH equipment-requests/{id}/lines/batch, all or nothing
  //   3 when every line of the request is now on site (DEPLOYED, DELIVERED or CONSUMED): PATCH the header DEPLOYED
  //   4 the request read again
  // One guard is Next's: New issues a consumable whose subclass auto-consumes (consumableFlag and autoConsumeFlag 'Y')
  // from stock as it is accepted (views/line-detail-units, then POST inventory-consumptions), and that material issue
  // reaches Fusion Inventory. Next does not write to Fusion, so an acceptance with such a piece is not started at all
  // (nothing is written) and is left to New. Without one, New's chain makes exactly the calls below.
  const SOURCE_STATE = 'SHIP_TO_SITE';
  const ON_SITE_STATES = ['DEPLOYED', 'DELIVERED', 'CONSUMED'];

  // SHIP_TO_SITE forks by what the line is: a rental goes DEPLOYED, a consumable goes DELIVERED (New's targetFor).
  const targetFor = (line) => ((line && line.consumableFlag === 'Y') ? 'DELIVERED' : 'DEPLOYED');

  // Stamp DELIVERED_QUANTITY as a consumable goes on site (New's bodyFor).
  const bodyFor = (line) => {
    const target = targetFor(line);
    const body = { lineStatus: target };
    if (target === 'DELIVERED') {
      const q = Number(line && line.quantity);
      if (Number.isFinite(q) && q > 0) body.deliveredQuantity = q;
    }
    return body;
  };

  class acceptDeliveryChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
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
        v.banner = { type: 'info', text: 'Nothing to accept: none of these pieces is on its way to you.', link: '' };
        return;
      }
      const fromStock = eligible.filter(V.issuesFromStock);
      if (fromStock.length) {
        const pl = V.plan('accept', v.lines, v.ticks);
        v.banner = { type: 'warning', text: 'Nothing was accepted. ' + pl.text,
          link: V.newRequestPage(($application.variables.appUrls || {}).new, 'customer-request', v.head.requestNumber, numericId) };
        return;
      }

      v.busy = 'accept';
      let done = false;
      try {
        const plans = eligible.map((l) => ({ line: l, body: bodyFor(l) }));
        const batch = await lineBody.updateLines(context, Actions, {
          requestId: numericId,
          headers: cu.auditHeaders(context),
          updates: plans.map((p) => Object.assign({ id: Number(p.line.lineId) }, p.body)),
          labels: plans.map((p) => p.line.equipmentName),
        });
        if (!batch.ok) {
          v.banner = { type: 'error', text: 'Nothing was accepted: ' + batch.message + ' No line was changed.', link: '' };
          return;
        }

        // Header rollup, computed from the lines this tab read and this call's own results (New's rule: a re-read right
        // after the PATCH can see the old statuses).
        const succeeded = new Set(eligible.map((l) => l.lineId));
        const all = v.lines || [];
        const allDeployed = all.length > 0 && all.every((l) => succeeded.has(l.lineId) || ON_SITE_STATES.indexOf(l.lineStatus) !== -1);
        let headerDeployed = false;
        if (allDeployed) {
          const headerPatch = await Actions.callRest(context, {
            endpoint: 'eqp-v1/patchEquipmentRequest',
            uriParams: { id: numericId },
            body: { status: 'DEPLOYED' },
          }).catch((e) => ({ ok: false, error: e }));
          if (headerPatch.ok) headerDeployed = true;
          else console.warn('[customer acceptDeliveryChain] header DEPLOYED PATCH failed:', headerPatch.status);
        }

        const n = eligible.length;
        let message = n + (n === 1 ? ' piece was' : ' pieces were') + ' accepted and ' + (n === 1 ? 'is' : 'are') + ' on your site now.';
        if (skipped > 0) message += ' ' + skipped + (skipped === 1 ? ' other piece was' : ' other pieces were') + ' left as ' + (skipped === 1 ? 'it was' : 'they were') + '.';
        if (headerDeployed) message += ' Everything on this request is on your site.';
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

  return acceptDeliveryChain;
});
