define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/maintAssetLocation',
  'resources/js/requestLineBody',
  'resources/js/currentUser'
], (ActionChain, Actions, maintAssetLocation, lineBody, cu) => {
  'use strict';

  // PICK AND SHIP — advances PICK_INITIATED → SHIP_TO_SITE.
  //
  // Backs the "Pick and Ship" button in the picking dialog. Release for Picking
  // moves lines ALLOCATED → PICK_INITIATED and STOPS there; this is the second,
  // deliberate hop, run once the warehouse has actually picked the equipment.
  //
  // Release used to make this transition itself, in the same click (earlier, in
  // a 5s fire-and-forget timer), which marked equipment shipped the moment it
  // was released for picking — a status that described an intention rather than
  // an event. Splitting it means SHIP_TO_SITE is only ever set by someone
  // asserting the equipment really went out.
  //
  // Only touches lines currently at PICK_INITIATED, read live from the server
  // rather than trusting the in-memory drawer state, so it can't clobber a
  // line someone else has since moved. Partial failures are reported rather
  // than swallowed.
  //
  // NOTE: the class/file name is historical — it began as recovery for lines
  // stranded by the old auto-advance. It is now the normal shipping path.
  class ShipConfirmStuckLinesChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const req = $page.variables.selectedRequest;
      const requestId = req && (req.eqrEquipmentRequestId || req.id);
      if (!requestId) return;

      $page.variables.isShipConfirming = true;

      const notify = async (payload) => {
        try {
          await Actions.fireNotificationEvent(context, payload);
        } catch (e) {
          console.warn('[ShipConfirmStuckLinesChain] toast failed:', e);
        }
      };

      try {
        // Read current line states from the server — the drawer's copy may be
        // stale, and acting on stale state is what we're recovering from.
        const resp = await Actions.callRest(context, {
          endpoint:  'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
          // size: the endpoint defaults to 20 rows.
          uriParams: { requestId: Number(requestId), size: 2000 }
        });

        if (!resp || !resp.ok || !resp.body || !Array.isArray(resp.body.data)) {
          await notify({
            summary:     'Pick and Ship',
            message:     'Could not read current line statuses. Try Refresh first.',
            type:        'error',
            displayMode: 'persist'
          });
          return;
        }

        // SCOPED TO THE SELECTED TRANSFER ORDER.
        //
        // The button next to the LOV now reads as "ship THIS transfer order", so
        // shipping every PICK_INITIATED line on the request would silently ship
        // lines belonging to orders the user did not select. The lines endpoint
        // carries no transfer-order field, so the drawer's own line list — built
        // in openPickingDrawerChain from getTransferOrderLines — is what maps a
        // line to its toNumber; we intersect the live statuses with that mapping.
        //
        // Falls back to request-wide when the selected TO cannot be resolved to
        // an order number (a TO still being created in Fusion has none yet), which
        // preserves the previous behaviour rather than silently shipping nothing.
        const selTO = ($page.variables.selectedRequestTOs || [])
          .find(t => String(t.value) === String($page.variables.selectedTOId));
        const selOrderNumber = String((selTO && selTO.orderNumber) || '');

        const lineIdsForTO = new Set();
        if (selOrderNumber) {
          ((req && req.lines) || []).forEach((l) => {
            if (String(l.toNumber || '') === selOrderNumber) {
              lineIdsForTO.add(String(l.lineId));
            }
          });
        }

        const atPickInitiated = resp.body.data.filter(l => l.lineStatus === 'PICK_INITIATED');
        const stuck = lineIdsForTO.size
          ? atPickInitiated.filter(l => lineIdsForTO.has(String(l.id)))
          : atPickInitiated;

        // ── F&M lines ship from PICK_INITIATED, like S&T ────────────────────
        // An F&M line (Fixed-asset / Maintenance tracked, not inventory
        // tracked) has no Transfer Order, but it takes the SAME two steps:
        // Release for Picking advances it ALLOCATED → PICK_INITIATED (by line
        // selection rather than by TO — see ReleaseTransferOrderChain's F&M
        // branch), and this ships it PICK_INITIATED → SHIP_TO_SITE.
        //
        //   S&T:  ALLOCATED → PICK_INITIATED → SHIP_TO_SITE   (release via TO)
        //   F&M:  ALLOCATED → PICK_INITIATED → SHIP_TO_SITE   (release via ticks)
        //
        // So the ONLY difference here is scoping: S&T lines are matched through
        // the selected transfer order, F&M lines through the drawer's own rows,
        // because they carry no toNumber to match on. Both require
        // PICK_INITIATED — an F&M line still sitting at ALLOCATED has not been
        // released yet and must not ship.
        //
        // GATED ON THE DRAWER'S VIEW, not on live status alone: only lines the
        // drawer knows to be F&M take this path, so an S&T line can never be
        // swept in by it.
        //
        // RESTRICTED TO THE TICKED LINES when anything is ticked. F&M lines are
        // chosen by checkbox — that is how Release for Picking works — so Ship
        // must honour the same selection. It previously shipped EVERY F&M line
        // at PICK_INITIATED on the request, which meant ticking one line and
        // clicking Pick and Ship also shipped unticked lines that happened to be
        // released already. Selecting a line and having a DIFFERENT one change
        // status is the worst kind of surprise here: it moves real equipment
        // state, and nothing on screen said it would happen.
        //
        // With nothing ticked the behaviour is unchanged — every released F&M
        // line ships, which is the sensible reading of "Pick and Ship" with no
        // selection, and matches how the S&T path treats its transfer order.
        const tickedFAndMIds = new Set(
          (($page.functions && typeof $page.functions.selectedLines === 'function')
            ? ($page.functions.selectedLines() || [])
            : [])
            .filter(l => l && l.isFAndM === true)
            .map(l => String(l.lineId))
        );

        const fAndMLineIds = new Set(
          ((req && req.lines) || [])
            .filter(l => l && l.isFAndM === true)
            .filter(l => tickedFAndMIds.size === 0 || tickedFAndMIds.has(String(l.lineId)))
            .map(l => String(l.lineId))
        );
        const fAndMAtAllocated = fAndMLineIds.size
          ? resp.body.data.filter(l => l.lineStatus === 'PICK_INITIATED'
                                       && fAndMLineIds.has(String(l.id)))
          : [];

        // De-dupe defensively: a line can only hold one status, so the two sets
        // cannot overlap today, but keying by id means a future status change
        // can't produce a double PATCH.
        const seenIds = new Set();
        const toShip = stuck.concat(fAndMAtAllocated).filter(l => {
          const k = String(l.id);
          if (seenIds.has(k)) return false;
          seenIds.add(k);
          return true;
        });

        if (!toShip.length) {
          // Distinguish "you ticked lines, but none of them are ready" from
          // "nothing on this request is ready". Ticking an ALLOCATED line and
          // clicking Pick and Ship lands here: the honest answer is that the
          // ticked lines still need releasing — NOT that the request has
          // nothing to ship, and certainly not to go and ship something else.
          const tickedNotReady = tickedFAndMIds.size > 0;
          await notify({
            summary:     'Pick and Ship',
            message:     tickedNotReady
              ? ('The selected line(s) are not released yet. Use Release for Picking first — ' +
                 'only lines at Pick Initiated can be shipped.')
              : (selOrderNumber
                  ? ('No lines are at Pick Initiated on transfer order ' + selOrderNumber
                     + '. Release it for picking first.')
                  : 'No lines are ready to ship on this request. Release a transfer order for picking first.'),
            type:        'info',
            displayMode: 'persist'
          });
          return;
        }

        // ONE batch PATCH for every line to ship (one transaction, all or
        // nothing), replacing a per-line Promise.all.
        const shipBatch = await lineBody.updateLines(context, Actions, {
          requestId: Number(requestId),
          headers:   cu.auditHeaders(context),
          updates:   toShip.map(l => ({ id: Number(l.id), lineStatus: 'SHIP_TO_SITE' }))
        });
        let ok = 0;
        const failed = [];
        if (shipBatch.ok) {
          ok = toShip.length;
        } else {
          console.warn('[ShipConfirmStuckLinesChain] ship batch failed, no line changed:', shipBatch.message);
          toShip.forEach(l => failed.push(Number(l.id)));
        }

        if (ok) $page.variables.pickInitiatedWarning = '';

        // ── Fusion: relocate the maintenance asset ───────────────────────────
        // Only for lines that ACTUALLY shipped (`failed` excluded) — a line whose
        // status PATCH was rejected has not left the yard, and telling Fusion it
        // moved would make the asset's location a lie.
        //
        // AFTER the status PATCH and outside its Promise.all on purpose: the line
        // status is the source of truth for shipping, this is a downstream
        // notification. It is also wrapped so that nothing it does can fail the
        // ship — a Fusion outage must not turn a successful Pick and Ship into an
        // error the warehouse has to puzzle over.
        //
        // The helper does its own gating: off unless MAINT_ASSET_LOCATION_SYNC_ENABLED
        // (fails closed), skips unless the request delivers to an internal
        // location, and skips inventory-tracked lines because Fusion moves those
        // itself. With the flag off it dry-runs and logs what it would have sent.
        let assetSync = null;
        try {
          const failedIds = new Set(failed.map(String));
          assetSync = await maintAssetLocation.relocateShippedAssets(context, Actions, {
            requestId: Number(requestId),
            lines:     toShip.filter(l => !failedIds.has(String(l.id)))
          });
          console.log('[ShipConfirmStuckLinesChain] maintenance-asset sync:', assetSync);
        } catch (e) {
          console.warn('[ShipConfirmStuckLinesChain] maintenance-asset sync threw:', e);
        }

        // Only ever ADDS to the message, and only when a real PATCH was rejected.
        // A dry run, a skip, or "this request isn't an internal delivery" are all
        // normal and say nothing to a warehouse user. A genuine Fusion rejection
        // does: the equipment shipped but its asset record still claims the old
        // location, and someone has to know to fix it.
        const assetNote = (assetSync && !assetSync.dryRun && assetSync.failed)
          ? (' ' + assetSync.failed + ' maintenance asset(s) could not be relocated in Fusion — ' +
             'the equipment still shipped; check the console and update the asset location manually.')
          : '';

        await notify({
          summary: (failed.length || assetNote) ? 'Pick and Ship — partially applied' : 'Pick and Ship Complete',
          message: (failed.length
            ? (ok + ' line(s) advanced to Shipped to Site; ' + failed.length + ' failed. Try again or check the request detail page.')
            : (ok + ' line(s) advanced to Shipped to Site.')) + assetNote,
          type:        (failed.length || assetNote) ? 'warning' : 'confirmation',
          displayMode: 'persist'
        });

        // Re-read so the grid reflects the new statuses without a manual
        // close/reopen of the dialog.
        try {
          await Actions.callChain(context, {
            chain:  'openPickingDrawerChain',
            params: { rowData: req }
          });
        } catch (e) {
          console.warn('[ShipConfirmStuckLinesChain] drawer refresh failed:', e);
        }
      } catch (e) {
        console.error('[ShipConfirmStuckLinesChain] failed:', e);
        await notify({
          summary:     'Pick and Ship Failed',
          message:     (e && e.message) || 'Unexpected error advancing lines.',
          type:        'error',
          displayMode: 'persist'
        });
      } finally {
        $page.variables.isShipConfirming = false;
      }
    }
  }

  return ShipConfirmStuckLinesChain;
});
