define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // New EquipRite's equipment-import-page-chains/SaveStagingClassesChain.js (the old Equipment Master's chain), call
  // for call and guard for guard; it writes EquipRite only (the staging assignments, then promote). What differs in
  // Next: notices are the shell's toasts (the result stays on the page in stagingSaveMessage, as before), and the old
  // dialog's refresh of the list behind it is back when items went in (the list is on this screen again).
  /**
   * Import the TICKED rows of the review grid: confirm their class/subclass and
   * merge them into EQR_EQUIPMENT_MASTER.
   *
   * Since 2026-10-03 nothing merges without this step. Fetch classifies items
   * from the Class Mapping config as AUTO_MAPPED (a suggestion with the class
   * filled in) and promote merges only MAPPED rows, which only this PATCH
   * writes. Each ticked row is sent with the user's pending class edit if it
   * has one, otherwise with the class already on the row. An edited row that
   * is not ticked is NOT imported.
   *
   * ONE bulk PATCH, not one call per row. The per-row pattern used elsewhere
   * (setup/configurations saveChangesChain) awaits inside a for-loop; at 100
   * rows that is ~15s of spinner, and a failure list of 100 ids is not
   * something a person can act on. Per-row granularity comes back through the
   * response's failed[] instead.
   *
   * The endpoint sets IMPORT_STATUS='MAPPED' as well as the class. That is
   * load-bearing: resolve_and_promote reads
   *   WHERE IMPORT_STATUS='MAPPED' AND RESOLVED_CLASS_ID IS NOT NULL
   * so a class written without the status would leave the row unpromotable
   * and the user's work would silently do nothing.
   */
  class SaveStagingClassesChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      // Not while Fetch or Clear is writing staging (isBusy also covers a
      // second click on Import): a Fetch deletes unconfirmed rows on batch 1,
      // and two promotes at once race on the same job-log row.
      if ($page.functions.isBusy($page.variables)) return { ok: false, reason: 'BUSY' };

      const built = $page.functions.buildImportBody(
        $page.variables.stagingSelectedRows,
        $page.variables.stagingChangedRows,
        $page.variables.stagingArray);
      const assignments = (built && built.assignments) || [];
      const noClass = (built && built.noClass) || 0;
      const body = { assignments: assignments };

      // Ticked rows with no class cannot be imported -- the PATCH would mark
      // them MAPPED with nothing to promote. Say so rather than sending an
      // empty array and reporting a hollow success.
      if (!assignments.length) {
        $page.variables.stagingSaveMessage = noClass
          ? 'Nothing to import: the ticked row' + (noClass === 1 ? ' has' : 's have') +
            ' no Class. Set a Class, then Import.'
          : 'Nothing to import. Tick the rows to import.';
        return { ok: false, reason: 'EMPTY' };
      }

      $page.variables.stagingSaving = true;
      $page.variables.stagingSaveMessage = '';
      this.promoteBusy = false;

      try {
        const resp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/patchEquipmentImportStagingAssignments',
          body: body
        });

        if (!resp || !resp.ok) {
          const msg = 'Could not import. Nothing was changed.';
          $page.variables.stagingSaveMessage = msg;
          bus.toast('Import failed: ' + msg, 'error');
          return { ok: false, reason: 'HTTP' };
        }

        const respBody = resp.body || {};
        const updated  = respBody.updated || 0;
        const failed   = Array.isArray(respBody.failed) ? respBody.failed : [];

        // Clear only what actually saved. A failed row keeps its pending edit
        // so the user can see it and retry, rather than having their change
        // silently discarded along with the successful ones.
        const failedIds = {};
        failed.forEach(f => { if (f && f.fusionInventoryItemId != null) failedIds[f.fusionInventoryItemId] = f.reason || 'FAILED'; });

        // Edits: keep those of rows NOT sent (unticked) and of failed rows.
        const sentIds = {};
        assignments.forEach(a => { sentIds[a.fusionInventoryItemId] = true; });
        const remaining = {};
        const changed = $page.variables.stagingChangedRows || {};
        Object.keys(changed).forEach(k => {
          if (!sentIds[k] || failedIds[k] !== undefined) remaining[k] = changed[k];
        });
        $page.variables.stagingChangedRows = remaining;

        // Ticks: keep only the failed ones, so a retry is one click.
        const stillTicked = {};
        Object.keys($page.variables.stagingSelectedRows || {}).forEach(k => {
          if (failedIds[k] !== undefined) stillTicked[k] = true;
        });
        $page.variables.stagingSelectedRows = stillTicked;

        // ── Promote ──────────────────────────────────────────────────
        // Saving writes IMPORT_STATUS='MAPPED'. That alone puts NOTHING in
        // EQR_EQUIPMENT_MASTER, so the item never reaches the catalogue --
        // promotion is a separate step and this is the only place that can
        // call it after a human classifies. ImportFromFusionChain also calls
        // promote, but it runs BEFORE anyone has classified anything, when
        // there are no MAPPED rows to promote.
        //
        // resolve_and_promote is safe to call here: its resolve step carries
        // `WHERE T.RESOLVED_CLASS_ID IS NULL -- never overwrite a human
        // decision`, so it skips the rows just saved and promotes them on
        // step 2 (WHERE IMPORT_STATUS='MAPPED' AND RESOLVED_CLASS_ID IS NOT
        // NULL). It is idempotent, so a repeat call is harmless.
        //
        // No runId: promote everything eligible. Scoping to one run would
        // miss rows classified across several sittings.
        let promoted = 0;
        let promoteFailed = false;
        if (updated > 0) {
          const promoteResp = await Actions.callRest(context, {
            endpoint: 'eqp-v1/promoteEquipmentImport',
            body: {}
          }).catch(() => null);

          if (promoteResp && promoteResp.ok && promoteResp.body) {
            promoted = promoteResp.body.promoted || 0;
          } else if (promoteResp && promoteResp.status === 409) {
            // A Fetch or Sync holds the group lock (V387). The rows ARE
            // classified; they go in on the next Import or Fetch.
            promoteFailed = true;
            this.promoteBusy = true;
          } else {
            // The assignments ARE saved -- only promotion failed. Say so
            // precisely: the user's work is not lost and re-saving would
            // promote it, so this must not read as "save failed".
            promoteFailed = true;
          }
        }

        let message = updated + ' item' + (updated === 1 ? '' : 's') + ' confirmed.';
        if (promoted > 0) {
          // Imported rows are deleted from staging at promote (2026-10-05),
          // so they disappear from this grid on the reload below.
          message += ' ' + promoted + ' added to the equipment master and removed from this list.';
        } else if (promoteFailed && this.promoteBusy) {
          message += ' Classified. Another import or sync is running — press Import again' +
                     ' when it finishes to add them to the equipment master.';
        } else if (promoteFailed) {
          message += ' Classified, but they could not be added to the equipment master yet' +
                     ' — press Import again to retry.';
        }
        if (noClass) {
          message += ' ' + noClass + ' ticked row' + (noClass === 1 ? ' was' : 's were') +
                     ' skipped: no Class set.';
        }
        if (failed.length) {
          // Group by reason — "12 ALREADY_MERGED" is actionable, twelve ids are not.
          const byReason = failed.reduce((acc, f) => {
            const r = (f && f.reason) || 'FAILED';
            acc[r] = (acc[r] || 0) + 1;
            return acc;
          }, {});
          message += ' ' + failed.length + ' could not be imported: ' +
            Object.keys(byReason).map(r => byReason[r] + ' ' + r).join(', ') + '.';
        }

        $page.variables.stagingSaveMessage = message;

        const degraded = failed.length > 0 || promoteFailed;
        bus.toast((degraded ? 'Imported with errors: ' : 'Imported: ') + message, degraded ? 'warning' : 'info');

        // Reload so the grid shows the server's truth (imported rows are gone
        // from staging), rather than an optimistic local guess at it.
        // preserve: keep the failed rows ticked and the unticked rows' edits
        // that were deliberately kept above. A plain reload cleared both, which
        // undid that a few lines later (review, 2026-10-05).
        await Actions.callChain(context, { chain: 'LoadStagingChain', params: { preserve: true } });

        // Imported rows leave staging, so groups in "What to map next" shrink
        // or disappear. Refreshed here, not in LoadStagingChain, which paging
        // calls too.
        await Actions.callChain(context, { chain: 'LoadUnmatchedValuesChain' });

        // Refresh the equipment list on this screen: rows it did not have a moment ago are now in
        // EQR_EQUIPMENT_MASTER (the old dialog refreshed the grid behind it, when something was promoted).
        if (promoted > 0) {
          await Actions.callChain(context, { chain: 'refreshListChain', params: { list: true } });
        }

        return { ok: true, updated: updated, promoted: promoted, failed: failed.length };

      } catch (e) {
        const msg = 'Could not import. Nothing was changed.';
        $page.variables.stagingSaveMessage = msg;
        bus.toast('Import failed: ' + msg, 'error');
        return { ok: false, reason: 'EXCEPTION' };
      } finally {
        $page.variables.stagingSaving = false;
      }
    }
  }

  return SaveStagingClassesChain;
});
