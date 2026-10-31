define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/returnLeg',
  'resources/js/currentUser',
  'resources/js/requestData',
  'resources/js/rules',
  'resources/js/yardWork',
], (ActionChain, Actions, rl, cu, requestData, rules, yw) => {
  'use strict';

  // Records the return of fixed-asset units that came back without notice: New's DirectReturnChain for F&M rows, the same
  // calls in the same order, per request:
  //   1. POST requests/{id}/returns/reset   { lineIds }   only for lines the server flagged as a failed earlier return
  //   2. POST requests/{id}/returns/record  { lineIds }   RETURN_IN_PROCESS, one transaction (no transfer order: an F&M
  //                                                       line never went out on one)
  // EquipRite's own data only. A stock (S&T) unit needs an inbound transfer order in Fusion first (plan, reserve, OIC,
  // record): Next does not do that, so a selection with any stock unit is refused here, nothing is sent, and the page
  // links to New EquipRite.
  class recordReturnChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      const v = context.$page.variables;
      if (v.busy) return;
      const keys = v.foundTicks || [];
      const rows = (v.found || []).filter((r) => keys.indexOf(r.rowKey) !== -1);
      if (!rows.length) return;
      if (!yw.allFixedAssets(rows)) {
        v.findBanner = { type: 'warning', text: 'Nothing was recorded: a ticked unit is stock and needs a return transfer order in Fusion. Do it in New EquipRite, or tick only fixed assets.' };
        return;
      }
      if (rules.pageAccess($application.variables.pageAccessMap, $application.variables.pageAccessLoaded, 'EQR_EQUIPMENT_RETURNS') !== 'FULL') {
        v.findBanner = { type: 'error', text: 'Your role cannot record returns.' };
        return;
      }
      v.busy = 'record';
      v.findBanner = { type: '', text: '' };
      const headers = cu.auditHeaders(context);
      let fmDone = 0;
      const failures = [];
      try {
        const byRequest = new Map();
        rows.forEach((r) => {
          const k = Number(r.requestId);
          if (!byRequest.has(k)) byRequest.set(k, { requestId: k, requestNumber: r.requestNumber, fmLineIds: [] });
          const g = byRequest.get(k);
          if (g.fmLineIds.indexOf(Number(r.lineId)) === -1) g.fmLineIds.push(Number(r.lineId));
        });

        for (const g of byRequest.values()) {
          const needsReset = rows.filter((r) => Number(r.requestId) === g.requestId && r.to_needs_reset === true).map((r) => Number(r.lineId));
          if (needsReset.length) {
            const rs = await rl.resetFailedReturn(context, Actions, g.requestId, needsReset, headers);
            if (!rs.ok) {
              failures.push(g.requestNumber + ': ' + (rs.message || ('the failed return could not be reset (HTTP ' + rs.status + ')')));
              continue;
            }
          }
          const fmRec = await rl.recordReturn(context, Actions, g.requestId, g.fmLineIds, headers);
          if (fmRec.ok) fmDone += fmRec.linesPromoted;
          else failures.push(g.requestNumber + ': the fixed-asset return could not be recorded');
        }

        if (fmDone && !failures.length) {
          v.findBanner = { type: 'confirmation', text: fmDone + (fmDone === 1 ? ' fixed-asset unit' : ' fixed-asset units')
            + ' returned, no transfer order needed: ' + (fmDone === 1 ? 'it shows' : 'they show') + ' as being returned. Scan the next one.' };
        } else if (fmDone) {
          v.findBanner = { type: 'warning', text: fmDone + ' returned; ' + failures.length + ' failed: ' + failures.slice(0, 3).join('; ') + '.' };
        } else {
          v.findBanner = { type: 'error', text: 'Nothing was recorded: ' + (failures.slice(0, 3).join('; ') || 'no line was promoted') + '.' };
        }
      } catch (e) {
        console.error('[recordReturnChain] failed', e);
        v.findBanner = { type: 'error', text: 'The return was interrupted (' + ((e && e.message) || e) + '). Refresh to see where it stands.' };
      } finally {
        v.busy = '';
      }

      // The next scan starts clean, and the list follows (a returned line changes which section it is in).
      await Actions.callChain(context, { chain: 'closeScannerChain' });
      v.found = [];
      v.foundTicks = [];
      v.findQuery = '';
      v.foundMeta = { searched: false };
      if (fmDone) {
        requestData.invalidate();
        await Actions.callChain(context, { chain: 'loadChain', params: { refresh: false } });
      }
    }
  }

  return recordReturnChain;
});
