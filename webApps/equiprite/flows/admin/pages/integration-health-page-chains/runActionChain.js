define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/currentUser',
], (ActionChain, Actions, cu) => {
  'use strict';

  // Run now / Reprocess. Two kinds, the only reprocessing services/eqp-v1 offers:
  //   run      POST /int-configs/{syncCode}/run (runIntegrationSync): starts that EQR_INT_CONFIG sync in the
  //            background; 202 = started, 409 = already running. No body: the sync's own default mode.
  //   refresh  POST /fusion-sync/refresh-units (refreshFusionSyncUnits) { snapshot: 'N' }: moves staged stock onto
  //            the units. Always 'N' here: 'Y' (clear units Fusion no longer has) is only right straight after a
  //            complete stock read, which only Sync from Fusion on the Equipment page knows (old SyncFromFusionChain).
  // Both need Full access to the page (EQR_CONFIGURATIONS), a confirmation that says what will happen, and no
  // Fetch / Sync holding the group lock (the old RunInProgressChain's check: GET /fusion-sync/lock, fails open).
  class runActionChain extends ActionChain {
    /**
     * @param {Object} context
     * @param {Object} params
     * @param {string} params.type      run | refresh
     * @param {string} params.syncCode  EQR_INT_CONFIG sync code (run), or the job it reprocesses (refresh)
     * @param {boolean} [params.confirmed] false/absent: ask first
     */
    async run(context, { type, syncCode, confirmed }) {
      const { $page, $application } = context;
      const v = $page.variables;
      const fns = $page.functions;
      if ((type !== 'run' && type !== 'refresh') || !syncCode) {
        return;
      }
      const av = $application.variables;
      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_CONFIGURATIONS') !== 'FULL') {
        await Actions.fireNotificationEvent(context, {
          summary: 'Read only', message: 'Your role can see integration health but not run syncs.', type: 'warning', displayMode: 'transient',
        });
        return;
      }
      if (!confirmed) {
        v.confirm = { type, syncCode, text: fns.confirmText({ type, syncCode }) };
        return;
      }
      if (v.busyKey) {
        return;
      }
      v.confirm = null;
      v.busyKey = syncCode;
      try {
        const lockRes = await Actions.callRest(context, { endpoint: 'eqp-v1/getFusionSyncLock' }).catch(() => null);
        const lock = fns.lockState(lockRes && lockRes.ok ? lockRes.body : null);
        let result;
        let res = null;
        if (lock.running) {
          result = { type: 'warning', summary: 'Busy',
            message: `${lock.label} started ${fns.stamp(lock.since)} is still running. Try again when it finishes.` };
        } else if (type === 'refresh') {
          res = await Actions.callRest(context, {
            endpoint: 'eqp-v1/refreshFusionSyncUnits',
            body: { snapshot: 'N' },
          }).catch(() => null);
          result = fns.refreshResult(res);
        } else {
          res = await Actions.callRest(context, {
            endpoint: 'eqp-v1/runIntegrationSync',
            uriParams: { syncCode: syncCode },
            headers: cu.auditHeaders(context),
          }).catch(() => null);
          result = fns.runResult(res, syncCode);
        }
        v.lastResult = Object.assign({ key: syncCode }, result);
        await Actions.fireNotificationEvent(context, {
          summary: result.summary, message: result.message, type: result.type,
          displayMode: result.type === 'error' ? 'persist' : 'transient',
        });
        if (res && res.ok) {
          await Actions.callChain(context, { chain: 'loadHealthChain' });
        }
      } finally {
        v.busyKey = '';
      }
    }
  }

  return runActionChain;
});
