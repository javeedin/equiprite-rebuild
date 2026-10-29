define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Sync from Fusion — refresh what EquipRite already holds from Fusion.
   *
   * Carried over from the old equipment-master-page-chains/SyncFromFusionChain.js, call for call. Two changes:
   *   - the browser confirm() is the page's own question card: without { confirmed: true } the chain runs the
   *     same guards (access, busy, another run) and then asks; the card's button calls it again confirmed;
   *   - the list refresh at the end is this page's loadEquipmentChain (was RefreshEquipmentListChain).
   *
   * Unlike Import From Fusion it never brings in new items (those need a
   * class first). It updates:
   *   1. items already in the master: Fusion-owned fields only, never class /
   *      subclass. DELTA on the EQUIP_ITEM_REFRESH_SYNC row's own watermark,
   *      so only items Fusion changed since the last Sync are read.
   *   2. their units: the three yard-stock syncs, then
   *      POST /fusion-sync/refresh-units moves them onto EQR_SERIAL_REF /
   *      EQR_LOT_REF / EQR_INVENTORY_ITEM_REF.
   *
   * Rules (product owner, 2026-10-05), enforced in EQR_ITEM_REFRESH_PKG:
   *   - units no longer in Fusion's yard stock are zeroed / flagged, never
   *     deleted -- and ONLY when all three stock syncs completed (snapshot
   *     'Y'). After a partial read "missing" means "not read", not "gone".
   *   - a serial's Fusion location goes to its own FUSION_* columns;
   *     EquipRite's current location is untouched.
   *   - an item whose serial / lot control changed in Fusion while it has
   *     units keeps its flags and is reported as held.
   *   - button only, FULL access.
   */
  const ITEM_SYNC_CODE = 'EQUIP_ITEM_REFRESH_SYNC';
  const MAX_BATCHES = 500;

  class SyncFromFusionChain extends ActionChain {
    async run(context, params) {
      const { $page, $application } = context;
      const v = $page.variables;
      const av = $application.variables;

      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded,
            'EQR_EQUIPMENT_MASTER') !== 'FULL') {
        return;
      }
      if (v.isSyncing || $page.functions.isBusy(v)) {
        await this.notify(context, 'Busy', 'An import or sync is already running. Try again when it finishes.', 'warning');
        return;
      }
      // Another tab or user mid-Fetch / mid-Sync (isBusy only sees this tab).
      const other = await Actions.callChain(context, { chain: 'RunInProgressChain' }).catch(() => null);
      if (other && other.running) {
        await this.notify(context, 'Busy', other.label + ' started at ' +
          new Date(other.startedAt).toLocaleTimeString() + ' is still running. Try again when it finishes.', 'warning');
        return;
      }
      if (!(params && params.confirmed)) {
        v.ask = {
          kind: 'sync',
          title: 'Sync from Fusion?',
          message: 'Updates the Fusion fields of the items already here (never their class), then their serials, '
            + 'lots and on-hand. Units no longer in Fusion yard stock are zeroed or flagged, never deleted, and only '
            + 'when all stock was read. It takes a few minutes; you can keep working on this page.',
          ok: 'Start sync',
        };
        return;
      }
      v.ask = null;

      // One startTime for the whole run: the server's group lock (V387)
      // recognises our later calls (stock, refresh-units) by it.
      const startTime = new Date().toISOString().replace(/\.\d{3}Z$/, '');
      this.lockHeld = false;
      this.lockReleased = false;

      v.isSyncing = true;
      v.syncStep = 'items';
      v.syncResult = null;
      $page.functions.setLeaveGuard(true);
      await this.notify(context, 'Sync started',
        'Syncing from Fusion. You can keep working; you will be told when it finishes.', 'info');

      try {
        // ── 1. Items ─────────────────────────────────────────────────────
        const items = await this.syncItems(context, startTime);
        if (!items.ok) {
          const busy = $page.functions.busyText(items.message);
          await this.notify(context, busy ? 'Busy' : 'Sync failed',
            busy || ('Item sync failed: ' + items.message + ' Nothing else was changed.'),
            busy ? 'warning' : 'error', 'persist');
          return;
        }

        // ── 2. Stock into staging (the same three syncs Fetch runs) ──────
        v.syncStep = 'stock';
        const stock = await Actions.callChain(context, {
          chain: 'ImportUnitsFromFusionChain',
          params: { startTime: startTime }
        }).catch(() => null);
        const stockOk = !!(stock && stock.ok);

        // ── 3. Onto the unit tables; gone units only on a full snapshot ──
        v.syncStep = 'units';
        const resp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/refreshFusionSyncUnits',
          body: { snapshot: stockOk ? 'Y' : 'N' }
        }).catch(() => null);
        if (resp && resp.ok) this.lockReleased = true;   // refresh-units releases it
        if (resp && resp.status === 409) {
          await this.notify(context, 'Busy',
            'Items were updated, but another import or sync took over before the units ' +
            'were refreshed. Sync again when it finishes.', 'warning', 'persist');
          return;
        }
        if (!resp || !resp.ok || !resp.body) {
          await this.notify(context, 'Sync incomplete',
            'Items were updated, but the units could not be refreshed' +
            (resp && resp.status ? ' (HTTP ' + resp.status + ')' : '') + '.', 'error', 'persist');
          return;
        }

        const held = await this.heldItems(context, resp.body);
        const summary = $page.functions.syncSummary(resp.body, stockOk,
          stockOk ? '' : (stock && stock.message) || 'the stock sync did not finish', held);
        v.syncResult = summary;
        await this.notify(context, summary.title, summary.message, summary.type, 'persist');
        await Actions.callChain(context, { chain: 'loadEquipmentChain' });
      } catch (e) {
        await this.notify(context, 'Sync failed', 'Sync from Fusion could not be completed.', 'error', 'persist');
      } finally {
        if (this.lockHeld && !this.lockReleased) {
          await Actions.callChain(context, {
            chain: 'ReleaseSyncLockChain', params: { startTime: startTime }
          }).catch(() => null);
        }
        v.isSyncing = false;
        v.syncStep = '';
        $page.functions.setLeaveGuard(false);
      }
    }

    /**
     * EQUIP_ITEM_REFRESH_SYNC, batch by batch. Same response handling as
     * Fetch's item loop: the live response is { statusCode: "SUCCESS",
     * rowsMerged: "", hasMoreData: "" } -- a word, and empty strings -- so
     * status is normalised and only an explicit 'Y' continues.
     */
    async syncItems(context, startTime) {
      for (let batchNum = 1; batchNum <= MAX_BATCHES; batchNum++) {
        // The server takes the lock at the start of batch 1, before it can
        // fail: once a batch is sent the lock may be ours (see Fetch).
        this.lockHeld = true;
        const resp = await Actions.callRest(context, {
          endpoint: 'ics/runFusionTableSync',
          body: { syncCode: ITEM_SYNC_CODE, startTime: startTime,
                  // DELTA: the engine sends this row's LAST_RUN_DATE.
                  fullSyncFlag: 'N', batchNum: batchNum }
        }).catch(() => null);
        if (!resp || !resp.ok) {
          return { ok: false, message: 'could not reach the Fusion sync service.' };
        }
        const body = resp.body || {};
        const status = String(body.statusCode || '').toUpperCase();
        if (status.charAt(0) === 'E' || status === 'FAILED' || status === 'FAILURE') {
          // Refused because another run holds the lock: not ours to release.
          if (batchNum === 1 && /^BUSY\b/i.test(String(body.statusMsg || ''))) this.lockHeld = false;
          return { ok: false, message: body.statusMsg || 'the sync reported an error.' };
        }
        if (String(body.hasMoreData || '').toUpperCase() !== 'Y') {
          return { ok: true };
        }
      }
      return { ok: false, message: 'more batches than expected; stopped after ' + MAX_BATCHES + '.' };
    }

    /** Equipment numbers of held items, for the summary. Quiet on failure. */
    async heldItems(context, counts) {
      if (!(Number(counts.itemsHeld) > 0)) return [];
      const r = await Actions.callRest(context, {
        endpoint: 'eqp-v1/getFusionSyncExceptions',
        uriParams: { status: 'OPEN' }
      }).catch(() => null);
      const rows = r && r.ok && r.body
        ? (Array.isArray(r.body) ? r.body : (Array.isArray(r.body.items) ? r.body.items : []))
        : [];
      return rows.map(x => x && (x.equipmentNumber || x.fusionInventoryItemId)).filter(Boolean);
    }

    async notify(context, summary, message, type, displayMode) {
      await Actions.fireNotificationEvent(context, {
        summary: summary, message: message, type: type, displayMode: displayMode || 'transient'
      });
    }
  }

  return SyncFromFusionChain;
});
