define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Drop OUR run's group lock when a Fetch or Sync gives up before its final
   * step (promote / refresh-units release it themselves). Without this a run
   * that failed at the item step blocks every Fetch and Sync for the full
   * 20-minute stale window.
   *
   * Called only by a run that HOLDS the lock (at least one batch was
   * accepted), and always with that run's startTime, so it can never drop
   * another run's lock. Quiet: a failed release only means the server reaps
   * the lock after 20 minutes.
   */
  class ReleaseSyncLockChain extends ActionChain {
    async run(context, params) {
      const startTime = params && params.startTime;
      if (!startTime) return { ok: false };
      const r = await Actions.callRest(context, {
        endpoint: 'eqp-v1/releaseFusionSyncLock',
        uriParams: { startTime: startTime, reason: 'ABANDONED_BY_CLIENT' }
      }).catch(() => null);
      return { ok: !!(r && r.ok) };
    }
  }

  return ReleaseSyncLockChain;
});
