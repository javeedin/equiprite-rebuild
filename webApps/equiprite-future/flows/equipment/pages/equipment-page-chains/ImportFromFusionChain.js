define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  /**
   * New EquipRite's equipment-import-page-chains/ImportFromFusionChain.js (the old Equipment Master's chain), call
   * for call and guard for guard. It reads Fusion (through the ICS sync) and writes EquipRite's staging and master;
   * nothing is written to Fusion. What differs in Next:
   *   - notices are the shell's toasts (bus.toast); the result stays on the page as before (importMessage);
   *   - the old dialog's last step is back: the list is on this screen again, so it is read again after a Fetch
   *     (refreshListChain, which also counts what waits for review and reads the job log's latest runs).
   *
   * "Fetch" in Import From Fusion — pulls Fusion item DEFINITIONS and their
   * STOCK, classifies the items, and promotes both.
   *
   *   1. items  EQUIP_ITEM_DEF_SYNC -> EQR_EQUIPMENT_MASTER_T (definition grain)
   *   2. stock  serials / lots / on-hand -> EQR_SERIAL_REF_T / EQR_LOT_REF_T /
   *             EQR_INVENTORY_ITEM_REF_T (ImportUnitsFromFusionChain)
   *   3. promote  resolve_and_promote: each item is classified from the Class
   *             Mapping config by CLASS_MAPPING_PRECEDENCE (AUTO_MAPPED / ERRORED
   *             / UNMAPPED). A match is a SUGGESTION: it merges only when a
   *             person ticks the row and clicks Import (SaveStagingClassesChain).
   *             Stock of items already in the master is refreshed here.
   *
   * Stock is fetched BEFORE classifying on purpose: the Fixed Asset and
   * Maintenance values a class can be mapped on live on the asset, which only
   * arrives with the serial stock.
   *
   * ── HOW THIS WORKS ────────────────────────────────────────────────────
   * The OIC integration EQP_CMN_FUSION_TABLE_SYNC_SUB is SYNCHRONOUS and
   * BATCHED, not fire-and-forget. Each call runs the BIP report, hands the XML
   * to EQR_INT_ENGINE_PKG.SYNC_SAAS_DATA (which invokes our merge package), and
   * returns rowsMerged plus hasMoreData. We loop until hasMoreData is 'N'.
   *
   * That means no polling: progress is exact and comes back with each batch,
   * and the run is finished when the loop ends rather than when a log row
   * happens to appear.
   *
   * Everything about WHAT is synced — report path, target table, merge
   * procedure, batch size — lives in the EQR_INT_CONFIG row named by syncCode.
   * This chain only drives the loop.
   *
   * Promotion (staging -> EQR_EQUIPMENT_MASTER) is called explicitly after the
   * last batch. The config row does set POST_SYNC_PROCESS, but
   * EQR_INT_ENGINE_PKG only returns that value to OIC and never executes it, so
   * we must not rely on it. resolve_and_promote is idempotent, so if OIC ever
   * does invoke it too, running twice is harmless.
   */
  const SYNC_CODE  = 'EQUIP_ITEM_DEF_SYNC';
  const JOB_NAME   = 'EQUIP_ITEM_DEF_SYNC';
  const MAX_BATCHES = 500;   // guard against a stuck hasMoreData='Y'

  class ImportFromFusionChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      // Guard against a second click, and against running while Import or
      // Clear is writing staging: a Fetch deletes unconfirmed rows on batch 1
      // and runs its own promote, so overlapping either corrupts both.
      if ($page.functions.isBusy($page.variables)) {
        return;
      }

      // A Fetch replaces the rows on screen. Ask before discarding ticks and
      // class edits; they were dropped silently before (review, 2026-10-05).
      if ($page.functions.pendingWorkCount($page.variables) > 0) {
        const ok = window.confirm(
          'Fetch from Fusion?\n\n' + $page.functions.pendingWorkText($page.variables) +
          ' will be discarded. Click Import first to keep them.');
        if (!ok) return;
        $page.variables.stagingSelectedRows = {};
        $page.variables.stagingChangedRows = {};
      }

      // Another tab or user mid-Fetch / mid-Sync: both rewrite staging, and
      // isBusy only sees this tab.
      const other = await Actions.callChain(context, { chain: 'RunInProgressChain' }).catch(() => null);
      if (other && other.running) {
        $page.variables.importWarning = other.label + ' started at ' +
          new Date(other.startedAt).toLocaleTimeString() +
          ' is still running. Fetch when it finishes.';
        return;
      }

      // Set once the grid has been reloaded on the success path; any other
      // exit reloads it in finally (see there).
      this.reloaded = false;

      // ── ITEM CLASS NARROWS THE FETCH (2026-10-09) ────────────────────
      // The Item Class dropdown is sent as extractFilter on every item batch.
      // The engine (get_sync_object_info, P_EXTRACT_FILTER, V402/V403)
      // intersects it with the environment's EXTRACT_FILTER -- a user can
      // narrow, never widen -- refuses a class outside that list ('E'), and
      // parks it on the lock row so merge_data's batch-1 cleanup deletes only
      // that class's unconfirmed rows. Item Type and Status still only filter
      // the review grid.
      //
      // Needs the OIC change in docs/OIC_CHANGE_STEPS_fetch_filter_2026-10-09.md
      // (trigger field + adapter regenerate + one mapping). Before that, OIC
      // drops the field and the Fetch pulls everything, as it always did.
      const fetchClass = $page.variables.selectedItemClass || null;
      $page.variables.importWarning = '';

      // The dialog is ALREADY open — OpenImportDialogChain put it there and the
      // Import button lives inside it. Assign state only; re-opening would
      // reset the user's selections underneath them.
      $page.variables.importDialogOpen = true;
      $page.variables.isImporting      = true;
      $page.functions.setLeaveGuard(true);
      $page.variables.importPhase      = 'RUNNING';

      $page.variables.importMessage =
        (fetchClass
          ? 'Requesting item definitions from Fusion (item class ' + fetchClass + ')…'
          : 'Requesting item definitions from Fusion (all items)…');

      // Shared across every batch of one logical run.
      const startTime = new Date().toISOString().replace(/\.\d{3}Z$/, '');

      let batchNum   = 1;
      let totalRows  = 0;
      // Group lock (V387): the server takes it at the START of batch 1 --
      // before that batch can fail (2026-10-09: batch 1 died on ORA-31011
      // with the lock already taken, and this run, believing it never held
      // it, left it to block every Fetch for 20 minutes). So once a batch
      // has been sent the lock may be ours; only a BUSY refusal means it is
      // someone else's. Released in finally unless promote released it.
      // The release carries this run's startTime, so it can never drop
      // another run's lock.
      this.lockHeld = false;
      this.lockReleased = false;

      try {
        // ── 1. Batch loop ────────────────────────────────────────────────
        while (batchNum <= MAX_BATCHES) {
          this.lockHeld = true;
          const resp = await Actions.callRest(context, {
            endpoint: 'ics/runFusionTableSync',
            // No itemClass / itemType here. They were once sent "for later",
            // but OIC drops them, and sending a filter that is silently
            // ignored made the screen look filtered when it was not. Filtering
            // is done on the staging read instead (LoadStagingChain).
            body: Object.assign({
              syncCode:     SYNC_CODE,
              startTime:    startTime,
              fullSyncFlag: 'Y',
              batchNum:     batchNum
            }, fetchClass ? { extractFilter: fetchClass } : {})
          });

          if (!resp || !resp.ok) {
            await this.fail(context,
              'Could not reach the Fusion sync service. Please try again.');
            return;
          }

          const body = resp.body || {};

          // ── THE LIVE RESPONSE DOES NOT MATCH THE OPENAPI CONTRACT ────
          // Measured 2026-09-25. The spec says statusCode 'S'/'E', rowsMerged
          // an integer, hasMoreData 'Y'/'N'. What actually comes back is:
          //     { "statusCode": "SUCCESS", "statusMsg": "Sync completed",
          //       "rowsMerged": "", "hasMoreData": "" }
          // a WORD, and empty strings for both numerics.
          //
          // This chain used to test statusCode === 'E', which would read a
          // returned "ERROR" as SUCCESS and show a confirmation toast over a
          // failed sync. The empty rowsMerged is already visible: the screen
          // read "0 equipment definitions imported from 00 Fusion items" --
          // that "00" is two empty strings concatenated.
          const status = String(body.statusCode || '').toUpperCase();
          if (status.charAt(0) === 'E' || status === 'FAILED' || status === 'FAILURE') {
            // Refused because another run holds the lock: not ours to release.
            if (batchNum === 1 && $page.functions.busyText(body.statusMsg)) this.lockHeld = false;
            await this.fail(context,
              $page.functions.busyText(body.statusMsg) ||
              body.statusMsg || 'The Fusion sync reported an error.',
              $page.functions.busyText(body.statusMsg) ? 'warning' : undefined,
              $page.functions.busyText(body.statusMsg) ? 'Busy' : undefined);
            return;
          }

          // '' -> 0, '1000' -> 1000. Number(undefined) is NaN, so the guard is
          // not decoration: without it one bad batch turns the total into NaN
          // and the message reads "NaN rows received".
          const merged = Number(body.rowsMerged);
          totalRows += (isNaN(merged) ? 0 : merged);

          $page.variables.importMessage =
            'Importing… ' + totalRows + ' row' + (totalRows === 1 ? '' : 's') +
            ' received' + (batchNum > 1 ? ' (batch ' + batchNum + ')' : '') + '.';

          // Only an explicit 'Y' continues. '' and anything else stop, erring
          // towards stopping: a wrong continue loops 500 times against a live
          // integration.
          if (String(body.hasMoreData || '').toUpperCase() !== 'Y') {
            break;
          }
          batchNum++;
        }

        if (batchNum > MAX_BATCHES) {
          await this.fail(context,
            'The import returned more batches than expected and was stopped ' +
            'after ' + MAX_BATCHES + '. No definitions were promoted.',
            'warning', 'Import Stopped');
          return;
        }

        // ZERO ITEMS IS NOT A REASON TO STOP ANY MORE. Items already in the
        // master are never re-staged (they update the master directly), so a
        // Fetch after everything was promoted stages 0 items -- and their STOCK
        // still has to be fetched and refreshed. Promote must run too: it is
        // what closes the RUNNING job-log row merge_data opened, and skipping
        // it is what left RUNNING rows behind on every empty run.

        // ── 2. Stock -> stock staging ────────────────────────────────────
        // Before classifying: Fixed Asset / Maintenance mappings match on
        // values that arrive with the serial's asset. This chain reports the
        // stock result; the stock chain only returns it.
        $page.variables.importMessage =
          totalRows + ' item row' + (totalRows === 1 ? '' : 's') +
          ' received. Importing stock (serials, lots, on-hand)…';

        const stock = await Actions.callChain(context, {
          chain: 'ImportUnitsFromFusionChain',
          params: { startTime: startTime }
        }).catch(() => null);

        // A failed stock sync does not stop the run: items are still worth
        // classifying, and already-staged stock is still promotable. It is
        // reported below rather than swallowed.
        const stockOk = !!(stock && stock.ok);

        // ── 3. Classify + promote items, then their stock ────────────────
        $page.variables.importMessage = 'Classifying items and promoting items and stock…';

        const promoteResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/promoteEquipmentImport',
          body: {}
        }).catch(() => null);

        // A failed promote means NOTHING was classified: the rows are
        // fetched but still unclassified / holding old suggestions. This used
        // to fall through to the counts, read the job log -- whose newest row
        // is this run's own still-RUNNING one, or another run's -- and announce
        // "Complete". Say what actually happened instead.
        if (promoteResp && promoteResp.ok) this.lockReleased = true;   // promote releases it
        if (promoteResp && promoteResp.status === 409) {
          await this.fail(context,
            'Another import or sync took over before classification ran. ' +
            'Fetch again when it finishes.', 'warning', 'Busy');
          return;
        }
        if (!promoteResp || !promoteResp.ok) {
          await this.fail(context,
            totalRows + ' item row' + (totalRows === 1 ? '' : 's') + ' fetched, but ' +
            'classification did not run, so the suggestions are not current. ' +
            'Fetch again; if it repeats, the classify step is failing on the server.',
            'error', 'Classification Failed');
          return;
        }

        // ── 4. Report ────────────────────────────────────────────────────
        // Typed fields from the promote response, plus the job-log NOTES
        // (errored=, serials=, lots=, onhand=, stockWaiting=) that the
        // response does not type yet.
        const counts   = await this.readCounts(context, promoteResp);
        const promoted = counts.promoted || 0;
        const needsWork = (counts.errored || 0) + (counts.ambiguous || 0) +
                          (counts.unmapped || 0) + (counts.noUnitPath || 0);

        // Fetch no longer merges what the Class Mapping matched: those rows
        // are AUTO_MAPPED and wait for a person to tick them and Import.
        // `promoted` is only rows a person had already confirmed.
        const autoMapped = counts.autoMapped || 0;
        let message = totalRows + ' Fusion item row' + (totalRows === 1 ? '' : 's') + ' fetched.';
        if (autoMapped > 0) {
          message += ' ' + autoMapped + ' auto-mapped from your Class Mapping — tick them and' +
                     ' click Import to merge.';
        }
        if (promoted > 0) {
          message += ' ' + promoted + ' previously confirmed item' + (promoted === 1 ? '' : 's') +
                     ' imported to the equipment master.';
        }

        if (needsWork > 0) {
          message += ' ' + needsWork + ' need' + (needsWork === 1 ? 's' : '') +
                     ' review: ' +
                     [
                       counts.errored    ? counts.errored    + ' errored by the class mapping (see Reason)' : null,
                       counts.ambiguous  ? counts.ambiguous  + ' matching more than one class' : null,
                       counts.unmapped   ? counts.unmapped   + ' with no class mapping source'  : null,
                       counts.noUnitPath ? counts.noUnitPath + ' with no unit pathway'          : null
                     ].filter(Boolean).join(', ') + '.';
        }

        const stockMoved = (counts.serials || 0) + (counts.lots || 0) + (counts.onhand || 0);
        if (stockOk) {
          message += ' Stock: ' + (counts.serials || 0) + ' serials, ' + (counts.lots || 0) +
                     ' lots, ' + (counts.onhand || 0) + ' on-hand rows promoted';
          message += counts.stockWaiting
            ? '; ' + counts.stockWaiting + ' waiting for their item to be classified.'
            : '.';
        } else {
          message += ' Stock import did not complete' +
                     (stock && stock.message ? ' (' + stock.message + ')' : '') +
                     (stockMoved ? '; stock staged earlier was still promoted.' : '.');
        }

        $page.variables.importPhase   = 'DONE';
        $page.variables.importMessage = message;

        // The toast says it wherever the person is; the line above keeps it on the Import view.
        bus.toast('Import complete: ' + message, (needsWork > 0 || !stockOk) ? 'warning' : 'info');

        // ── 4. Refresh both grids ────────────────────────────────────────
        // The import screen's staging grid first — that is what the user is
        // looking at, and it is the evidence for the counts just reported.
        await Actions.callChain(context, { chain: 'LoadStagingChain' });
        this.reloaded = true;

        // A Fetch re-runs the Class Mapping over every staged item, so the
        // "What to map next" groups change with it. After the grid, because
        // the grid is the evidence for the message just shown.
        await Actions.callChain(context, { chain: 'LoadUnmatchedValuesChain' });

        // Then the list (the old dialog refreshed the Equipment Master grid behind it here).
        await Actions.callChain(context, { chain: 'refreshListChain', params: { list: true } });

      } catch (e) {
        await this.fail(context, 'The Fusion import could not be completed.');
      } finally {
        if (this.lockHeld && !this.lockReleased) {
          await Actions.callChain(context, {
            chain: 'ReleaseSyncLockChain', params: { startTime: startTime }
          }).catch(() => null);
        }
        $page.variables.isImporting = false;
        $page.functions.setLeaveGuard(false);
        // Deliberately NOT closing the dialog. It now shows the result (how
        // many merged, how many need mapping) and the user dismisses it with
        // Close. Auto-closing threw that away the moment it appeared.

        // Every exit that did not reload (a failed sync, a failed promote, an
        // exception) still must: batch 1 of a FULL Fetch has already deleted
        // the unconfirmed rows, so the grid would show -- and Import would act
        // on -- rows that no longer exist.
        if (!this.reloaded) {
          await Actions.callChain(context, { chain: 'LoadStagingChain' }).catch(() => null);
          await Actions.callChain(context, { chain: 'LoadUnmatchedValuesChain' }).catch(() => null);
        }
      }
    }

    /**
     * Per-status counts. Prefers the promote endpoint's own response; falls
     * back to the latest EQR_JOB_RUN_LOG row, whose NOTES carries the same
     * split as a flat string.
     */
    async readCounts(context, promoteResp) {
      const body = (promoteResp && promoteResp.ok && promoteResp.body) || null;
      const typed = (body && typeof body.promoted !== 'undefined') ? body : {};
      const respNotes = this.parseCounts(body && body.notes);

      // The extended counts (errored, serials, lots, onhand, stockWaiting) are
      // written by resolve_and_promote into ITS job-log NOTES. The promote
      // endpoint does NOT pass those notes through -- it builds its own
      // "mapped=.. promoted=.." string (measured 2026-10-02: the dialog read
      // "0 serials, 0 lots, 0 on-hand" while the job log said onhand=247). So
      // the job log is read whenever the response lacks them.
      let logNotes = {};
      if (typeof respNotes.errored === 'undefined') {
        const logResp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getJobRunLogs',
          uriParams: { jobName: JOB_NAME, size: 1, orderBy: 'startedAt:desc' }
        }).catch(() => null);
        const rows = (logResp && logResp.ok && logResp.body && logResp.body.data) || [];
        logNotes = this.parseCounts(rows[0] && rows[0].notes);
      }

      // Precedence: typed response fields, then the response's notes, then the
      // job log -- so a backend that starts typing a field wins automatically.
      return Object.assign({}, logNotes, respNotes, typed);
    }

    // summary is passed explicitly rather than inferred from `type`: a warning
    // can mean "stopped", "nothing imported" or "still running", and those need
    // different wording.
    async fail(context, message, type, summary) {
      const { $page } = context;
      $page.variables.importPhase   = 'ERROR';
      $page.variables.importMessage = message;
      bus.toast((summary || (type === 'warning' ? 'Import incomplete' : 'Import failed')) + ': ' + message,
        type === 'warning' ? 'warning' : 'error');
    }

    parseCounts(notes) {
      const out = {};
      if (!notes) return out;
      String(notes).split(/\s+/).forEach((pair) => {
        const kv = pair.split('=');
        if (kv.length === 2) {
          const n = parseInt(kv[1], 10);
          if (!isNaN(n)) out[kv[0]] = n;
        }
      });
      return out;
    }
  }

  return ImportFromFusionChain;
});
