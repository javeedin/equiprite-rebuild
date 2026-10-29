define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Stock stage of Fetch — pulls PHYSICAL UNITS (serials, lots, on-hand stock)
   * into the stock STAGING tables EQR_SERIAL_REF_T / EQR_LOT_REF_T /
   * EQR_INVENTORY_ITEM_REF_T.
   *
   * Called only by ImportFromFusionChain, between the item sync and promote.
   * Progress goes to Fetch's status line, no toast is raised, and the result
   * ({ ok, total, results, message }) is RETURNED for Fetch to report. There
   * is no separate Import Units button any more, so the chain has no status
   * line or notifications of its own (removed 2026-10-05).
   *
   * ── WHY STOCK IS STAGED NOW ──────────────────────────────────────────
   * Every unit is staged, whether or not its item is classified yet -- no
   * master join in the merge. resolve_and_promote then (a) classifies items,
   * using the Fixed Asset / Maintenance values that arrive with the serial's
   * asset, and (b) moves staged stock whose item is in the master into
   * EQR_SERIAL_REF / EQR_LOT_REF / EQR_INVENTORY_ITEM_REF. Stock of an item
   * still awaiting a class waits in staging and moves on a later promote.
   *
   * Three syncs, one per EQR_INT_CONFIG row, run in priority order (9, 10, 11).
   * Yards only: EXTRACT_FILTER on those rows limits the report to the
   * EQUIPMENT_YARD orgs, which is what keeps the response under OIC's size cap.
   * Then EQUIP_ASSET_GROUP_SYNC (asset groups), reported apart as `groups`.
   *
   * ── THE ENGINE IGNORES STATUS ON THIS PATH ───────────────────────────
   * EQR_INT_ENGINE_PKG line 63 reads the config row by SYNC_CODE with NO
   * status filter. The ENABLED='Y' AND STATUS='ACTIVE' check is line 38, which
   * is the SCHEDULED JOB's loop. So these syncs run from here while their rows
   * are still INACTIVE — which is what keeps the scheduled job from picking
   * them up before a first run has been verified.
   */
  const SYNCS = [
    { code: 'EQUIP_UNIT_SERIAL_SYNC', label: 'serialised units', target: 'serials' },
    { code: 'EQUIP_UNIT_LOT_SYNC',    label: 'lots',             target: 'lots' },
    { code: 'EQUIP_UNIT_ONHAND_SYNC', label: 'on-hand stock',    target: 'on-hand' }
  ];

  // Fusion asset groups -> EQR_ASSET_GROUP_MEMBER_T. Runs AFTER the stock
  // syncs, so both promotes (resolve_and_promote, refresh-units) see it staged.
  // Kept OUT of ok / total: those are the STOCK result, and Sync turns ok into
  // its snapshot flag -- a group failure must never stop units being marked
  // gone. Its outcome is returned separately as `groups`.
  const GROUP_SYNC = { code: 'EQUIP_ASSET_GROUP_SYNC', label: 'asset groups', target: 'groups' };

  const MAX_BATCHES = 500;   // guard against a stuck hasMoreData='Y'

  class ImportUnitsFromFusionChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;

      if ($page.variables.isImportingUnits) {
        return { ok: false, reason: 'BUSY' };
      }

      // Optionally run ONE sync instead of all three — used to verify a single
      // target before trusting the set.
      const only = params && params.syncCode;
      const plan = only ? SYNCS.concat(GROUP_SYNC).filter(s => s.code === only) : SYNCS;

      if (!plan.length) {
        return { ok: false, reason: 'UNKNOWN_SYNC_CODE' };
      }

      $page.variables.isImportingUnits = true;
      this.progress(context, 'Requesting stock from Fusion…');

      // Shared across every batch of every sync in one logical run. Fetch and
      // Sync pass THEIR run's startTime: the server's group lock (V387) treats
      // calls with a different startTime as another run and refuses them, so
      // a fresh one here would have our own stock step refused as BUSY.
      const startTime = (params && params.startTime) ||
        new Date().toISOString().replace(/\.\d{3}Z$/, '');
      const results = [];

      try {
        for (const sync of plan) {
          this.progress(context, 'Importing ' + sync.label + '…');

          const outcome = await this.runOneSync(context, sync, startTime);
          results.push(outcome);

          // A failed sync stops the run. The ones already done stay staged —
          // promote can still move them.
          if (!outcome.ok) {
            return { ok: false, results: results,
                     message: 'the ' + sync.label + ' import failed: ' + outcome.message +
                              (results.length > 1 ? '; earlier steps in this run were kept' : '') };
          }
        }

        // Asset groups, once every stock sync has succeeded. Never changes the
        // stock result below; a throw here is a failed group step, not a failed run.
        let groups;
        if (!only) {
          this.progress(context, 'Importing ' + GROUP_SYNC.label + '…');
          groups = await this.runOneSync(context, GROUP_SYNC, startTime)
            .catch(() => ({ ok: false, target: GROUP_SYNC.target, rows: 0,
                            message: 'the asset group import could not be completed' }));
        }

        // ── "ran but reported nothing" is NOT the same as "nothing to do" ──
        // If the integration returned no row count at all, the merge probably
        // never executed. Saying so is the difference between a 20-minute
        // diagnosis and a day of it: on 2026-09-25 all three syncs returned
        // "SUCCESS" with rowsMerged:"" and wrote no EQR_INT_RUN_LOG row --
        // the BIP report was unreachable and the flow reported success anyway.
        const suspect = results.filter(r => r.suspect);
        if (suspect.length) {
          return { ok: false, total: 0, results: results, groups: groups, reason: 'NO_ROW_COUNT',
                   message: 'the sync ran but reported no row count for ' +
                     suspect.map(r => r.target).join(', ') +
                     '. That usually means the BIP report could not be read — check ' +
                     'BI_DATA_MODEL_PATH on the EQR_INT_CONFIG row, and whether an ' +
                     'EQR_INT_RUN_LOG entry was written.' };
        }

        return { ok: true, total: results.reduce((n, r) => n + r.rows, 0), results: results, groups: groups };

      } catch (e) {
        return { ok: false, reason: 'EXCEPTION', message: 'the stock import could not be completed' };
      } finally {
        $page.variables.isImportingUnits = false;
      }
    }

    /**
     * One sync, looped over its batches.
     *
     * The OIC integration is SYNCHRONOUS and BATCHED: each call runs the BIP
     * report, hands the XML to EQR_INT_ENGINE_PKG.SYNC_SAAS_DATA (which invokes
     * the merge package named on the config row), and returns rowsMerged plus
     * hasMoreData. Loop until hasMoreData is 'N' — no polling.
     */
    async runOneSync(context, sync, startTime) {
      const { $page } = context;
      let batchNum = 1;
      let rows = 0;
      let lastBody = null;   // kept for the "ran but reported nothing" check below

      while (batchNum <= MAX_BATCHES) {
        const resp = await Actions.callRest(context, {
          endpoint: 'ics/runFusionTableSync',
          body: {
            // syncCode is the ONLY input that selects behaviour. Report path,
            // target table, merge procedure and batch size are all read from
            // the EQR_INT_CONFIG row it names.
            syncCode:     sync.code,
            startTime:    startTime,
            // FULL, always. A delta watermark would permanently strand any
            // unit whose item was classified AFTER the unit's own last change:
            // its LAST_UPDATE_DATE is older than the watermark, so it would
            // never be re-offered. Re-reading a row we already have costs one
            // no-op match, because the merge only ever inserts.
            fullSyncFlag: 'Y',
            batchNum:     batchNum
          }
        }).catch(() => null);

        if (!resp || !resp.ok) {
          return { ok: false, target: sync.target, rows: rows,
                   message: 'could not reach the Fusion sync service' };
        }

        const body = resp.body || {};
        lastBody = body;

        // ── THE LIVE RESPONSE DOES NOT MATCH THE OPENAPI CONTRACT ──────
        // Measured 2026-09-25. The spec documents statusCode as 'S'/'E',
        // rowsMerged as an integer and hasMoreData as 'Y'/'N'. What actually
        // comes back is:
        //     { "statusCode": "SUCCESS", "statusMsg": "Sync completed",
        //       "rowsMerged": "", "hasMoreData": "" }
        // -- a WORD not a letter, and empty strings for both numerics.
        //
        // Every field is therefore normalised rather than compared literally.
        // An earlier version tested statusCode === 'E', which would have read
        // a returned "ERROR" as success.
        const status = String(body.statusCode || '').toUpperCase();
        if (status.charAt(0) === 'E' || status === 'FAILED' || status === 'FAILURE') {
          return { ok: false, target: sync.target, rows: rows,
                   message: body.statusMsg || 'the sync reported an error' };
        }

        // '' -> 0, '12' -> 12. Number('') is 0 but Number(undefined) is NaN,
        // so the NaN guard is not decoration: without it one bad batch turns
        // the whole run total into NaN and the message reads "NaN units".
        const merged = Number(body.rowsMerged);
        rows += (isNaN(merged) ? 0 : merged);

        this.progress(context,
          'Importing ' + sync.label + '… ' + rows + ' row' + (rows === 1 ? '' : 's') +
          (batchNum > 1 ? ' (batch ' + batchNum + ')' : '') + '.');

        // Only an explicit 'Y' continues. '' and anything else end the loop --
        // erring towards stopping, since a wrong continue loops 500 times
        // against a live integration.
        if (String(body.hasMoreData || '').toUpperCase() !== 'Y') break;
        batchNum++;
      }

      // A run that merged nothing AND said nothing is the signature of the
      // 2026-09-25 failure: the OIC flow stamped LAST_RUN_DATE, returned
      // "SUCCESS", and never reached SYNC_SAAS_DATA -- so no EQR_INT_RUN_LOG
      // row was written and no rows merged. Report the response verbatim
      // rather than let it read as "nothing to import", which is a DIFFERENT
      // and legitimate outcome.
      if (rows === 0 && lastBody && lastBody.rowsMerged === '') {
        return { ok: true, target: sync.target, rows: 0, suspect: true,
                 message: 'the sync returned no row count (' +
                          (lastBody.statusMsg || 'no message') + ')' };
      }

      if (batchNum > MAX_BATCHES) {
        return { ok: false, target: sync.target, rows: rows,
                 message: 'more batches than expected; stopped after ' + MAX_BATCHES };
      }

      return { ok: true, target: sync.target, rows: rows, message: '' };
    }

    // Progress shows on Fetch's own status line.
    progress(context, message) {
      context.$page.variables.importMessage = message;
    }
  }

  return ImportUnitsFromFusionChain;
});
