define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Is a Fetch or a Sync already running somewhere -- another tab, another
   * user? Returns { running, label, startedAt }.
   *
   * Reads the server lock (GET /fusion-sync/lock, EQR_INT_SYNC_LOCK, V387).
   * The lock itself is enforced by the engine -- a refused call comes back
   * statusCode 'E' / 'BUSY: …' -- so this is only the friendly early answer,
   * before anything is started. A lock idle past its stale limit is reaped by
   * the server on the next acquire, so it is not reported as running. Fails
   * OPEN: if the lock cannot be read, the run starts and the engine decides.
   */
  const LABELS = {
    FETCH: 'An Import From Fusion fetch',
    SYNC:  'A Sync from Fusion',
    STOCK: 'A stock sync'
  };

  class RunInProgressChain extends ActionChain {
    async run(context) {
      const r = await Actions.callRest(context, { endpoint: 'eqp-v1/getFusionSyncLock' })
        .catch(() => null);
      const b = r && r.ok && r.body;
      if (!b || !b.held) return { running: false };
      if (Number(b.idleSeconds) > Number(b.staleAfterSeconds)) return { running: false };
      return {
        running: true,
        label: LABELS[b.runLabel] || 'Another import or sync',
        startedAt: b.acquiredAt || b.startTime
      };
    }
  }

  return RunInProgressChain;
});
