define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/shellBus',
], (ActionChain, Actions, bus) => {
  'use strict';

  // New EquipRite's equipment-import-page-chains/ClearStagingChain.js (the old chain, with the browser confirm() as
  // the page's question card: called again with { confirmed: true }), call for call. What differs in Next: notices are
  // the shell's toasts (the result stays on the page in stagingSaveMessage, as before), and the count of what waits
  // for review is read again afterwards (refreshListChain, without the list: Clear never touches the master).
  /**
   * "Clear Fetch" (was "Clear Staging") — discard what Fetch brought in that
   * nobody has acted on. Since 2026-10-03 that includes AUTO_MAPPED rows: their
   * class is only a Class Mapping suggestion until someone ticks and imports.
   *
   * For: "the last import brought in junk, let me start over."
   *
   * NOT for re-importing with a different filter — a FULL sync already clears
   * staging on batch 1 (EQR_ITEM_IMPORT_MERGE_PKG.merge_data, body line 111).
   *
   * ── WHAT IS PROTECTED, AND WHY ───────────────────────────────────────
   * The endpoint deletes ONLY rows with RESOLVED_CLASS_ID IS NULL:
   *
   *   unclassified  -> DELETED. Costs nothing; Fusion re-sends them.
   *   MAPPED        -> KEPT. A human chose that class. Fusion can re-send the
   *                    item, but not the decision. Someone classifying 80 rows
   *                    over a morning must not lose them to a stray click.
   *   MERGED        -> KEPT. The audit trail from staged row to master row, and
   *                    what drives ALREADY_MERGED on the assignments PATCH.
   *
   * ── THE CONFIRM IS NOT DECORATION ────────────────────────────────────
   * It states the row count before deleting. Destructive and irreversible from
   * the UI: the rows can be re-fetched from Fusion, but only by running a
   * whole import.
   *
   * No role gate. The action only removes re-fetchable rows, and the FULL sync
   * already does the same thing unprompted on every run.
   */
  class ClearStagingChain extends ActionChain {
    async run(context, params) {
      const { $page } = context;

      // Not while Fetch or Import is running either (isBusy): clearing under
      // a Fetch deletes rows its batches are landing, under an Import the rows
      // being PATCHed.
      if ($page.functions.isBusy($page.variables)) {
        return { ok: false, reason: 'BUSY' };
      }

      const rows = Array.isArray($page.variables.stagingArray)
        ? $page.variables.stagingArray : [];
      const total = $page.variables.stagingTotalElements || rows.length;

      if (!total) {
        $page.variables.stagingSaveMessage = 'Nothing fetched to clear.';
        return { ok: false, reason: 'EMPTY' };
      }

      // A plain yes/no on purpose (2026-10-06). The rule behind it: only rows
      // a person classified by hand survive; Fetch brings the rest back.
      // (The old browser confirm() is the page's question card: unconfirmed, ask and stop.)
      if (!(params && params.confirmed)) {
        $page.variables.ask = {
          kind: 'clear',
          title: 'Clear the fetch?',
          message: 'Removes the ' + total.toLocaleString() + ' fetched item' + (total === 1 ? '' : 's') +
            ' nobody has classified by hand, auto-mapped ones included. Rows a person classified are kept; ' +
            'a new Fetch brings the rest back.',
          ok: 'Clear fetch',
        };
        return { ok: false, reason: 'ASKED' };
      }
      $page.variables.ask = null;

      $page.variables.stagingClearing = true;
      $page.variables.stagingSaveMessage = '';

      try {
        const resp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/clearEquipmentImportStaging'
        });

        if (!resp || !resp.ok) {
          const msg = 'Could not clear the fetch. Nothing was deleted.';
          $page.variables.stagingSaveMessage = msg;
          bus.toast('Clear failed: ' + msg, 'error');
          return { ok: false, reason: 'HTTP' };
        }

        const body    = resp.body || {};
        const deleted = Number(body.deleted) || 0;
        const kept    = (Number(body.keptMapped) || 0) + (Number(body.keptMerged) || 0);

        let message = deleted + ' fetched item' + (deleted === 1 ? '' : 's') + ' removed.';
        if (kept) {
          message += ' ' + kept + ' kept — ' +
            [ body.keptMapped ? body.keptMapped + ' already classified' : null,
              body.keptMerged ? body.keptMerged + ' already promoted'   : null
            ].filter(Boolean).join(', ') + '.';
        }

        $page.variables.stagingSaveMessage = message;
        bus.toast('Fetch cleared: ' + message, 'info');

        // Pending edits refer to rows that may no longer exist, and the page
        // the user was on may now be past the end of the result set.
        $page.variables.stagingChangedRows = {};
        $page.variables.stagingPage = 0;
        await Actions.callChain(context, { chain: 'LoadStagingChain' });
        // The cleared rows were the ERRORED ones the "What to map next" popup groups.
        await Actions.callChain(context, { chain: 'LoadUnmatchedValuesChain' });
        await Actions.callChain(context, { chain: 'refreshListChain', params: { list: false } });

        return { ok: true, deleted: deleted, kept: kept };

      } catch (e) {
        const msg = 'Could not clear the fetch. Nothing was deleted.';
        $page.variables.stagingSaveMessage = msg;
        bus.toast('Clear failed: ' + msg, 'error');
        return { ok: false, reason: 'EXCEPTION' };
      } finally {
        $page.variables.stagingClearing = false;
      }
    }
  }

  return ClearStagingChain;
});
