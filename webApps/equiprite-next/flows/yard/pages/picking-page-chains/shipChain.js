define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/maintAssetLocation',
  'resources/js/requestLineBody',
  'resources/js/currentUser',
  'resources/js/requestData',
  'resources/js/rules',
  'resources/js/yardWork',
], (ActionChain, Actions, maintAssetLocation, lineBody, cu, requestData, rules, yw) => {
  'use strict';

  // Pick and ship: PICK_INITIATED -> SHIP_TO_SITE, once the pieces have left the yard. New's ShipConfirmStuckLinesChain,
  // with the same calls in the same order:
  //   1. GET equipment-requests/{id}/lines?size=2000          the live statuses (never the workspace's copy)
  //   2. PATCH equipment-requests/{id}/lines/batch            { lines: [{ id, lineStatus: 'SHIP_TO_SITE' }] }, one
  //      transaction, for the single ticked transfer order's lines at Pick initiated (every line at Pick initiated when
  //      no single order is ticked) plus the fixed-asset lines at Pick initiated (the ticked ones, or all of them)
  //   3. maintAssetLocation.relocateShippedAssets             (copied unchanged) for what shipped
  //   4. the workspace read again (openWorkChain)
  // One guard is Next's: step 3 moves a maintenance asset in Fusion when MAINT_ASSET_LOCATION_SYNC_ENABLED is on and a
  // shipped line is maintenance tracked and not transactable. Next does not write to Fusion, so such a ship is not
  // started here at all (nothing is written) and is left to New EquipRite. Otherwise step 3 writes nothing: with the
  // flag off it is New's dry run (reads only), and with no such line it returns at once.
  class shipChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      const v = context.$page.variables;
      if (v.busy) return;
      if (rules.pageAccess($application.variables.pageAccessMap, $application.variables.pageAccessLoaded, 'EQR_INITIATE_PICKING') !== 'FULL') {
        v.banner = { type: 'error', text: 'Your role cannot ship equipment.' };
        return;
      }
      const req = v.work.req;
      const requestId = req && (req.eqrEquipmentRequestId || req.id);
      if (!requestId) return;
      v.busy = 'ship';
      v.banner = { type: '', text: '' };
      try {
        const resp = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1EquipmentRequestsRequestIdLines2',
          uriParams: { requestId: Number(requestId), size: 2000 },
        });
        if (!resp || !resp.ok || !resp.body || !Array.isArray(resp.body.data)) {
          v.banner = { type: 'error', text: 'Could not read the current line statuses, so nothing was shipped. Try Refresh first.' };
          return;
        }

        const selTO = (v.work.tos || []).filter((t) => String(t.value) === String(v.selectedTOId))[0];
        const selOrderNumber = String((selTO && selTO.orderNumber) || '');
        const lineIdsForTO = new Set();
        if (selOrderNumber) {
          (v.work.lines || []).forEach((l) => { if (String(l.toNumber || '') === selOrderNumber) lineIdsForTO.add(String(l.lineId)); });
        }
        const atPickInitiated = resp.body.data.filter((l) => l.lineStatus === 'PICK_INITIATED');
        const stuck = lineIdsForTO.size ? atPickInitiated.filter((l) => lineIdsForTO.has(String(l.id))) : atPickInitiated;

        const tickedFAndMIds = new Set(yw.selectedLines(v.work.lines, v.ticks).filter((l) => l && l.isFAndM === true).map((l) => String(l.lineId)));
        const fAndMLineIds = new Set((v.work.lines || [])
          .filter((l) => l && l.isFAndM === true)
          .filter((l) => tickedFAndMIds.size === 0 || tickedFAndMIds.has(String(l.lineId)))
          .map((l) => String(l.lineId)));
        const fAndMAtAllocated = fAndMLineIds.size
          ? resp.body.data.filter((l) => l.lineStatus === 'PICK_INITIATED' && fAndMLineIds.has(String(l.id))) : [];

        const seenIds = new Set();
        const toShip = stuck.concat(fAndMAtAllocated).filter((l) => {
          const k = String(l.id);
          if (seenIds.has(k)) return false;
          seenIds.add(k);
          return true;
        });

        if (!toShip.length) {
          v.banner = { type: 'info', text: tickedFAndMIds.size > 0
            ? 'The ticked pieces are not released yet: release them for picking first. Only pieces being picked can be shipped.'
            : (selOrderNumber
              ? 'No piece on transfer order ' + selOrderNumber + ' is being picked. It has to be released for picking first (in New EquipRite).'
              : 'Nothing on this request is ready to ship. Release it for picking first.') };
          return;
        }

        // Next's guard: shipping these would move maintenance assets in Fusion. Left to New; nothing is written.
        const syncOn = $application.functions.isFeatureEnabled($application.variables.featureFlags, $application.variables.flagsLoaded,
          'MAINT_ASSET_LOCATION_SYNC_ENABLED') === true;
        const relocating = yw.fusionRelocations(syncOn, toShip);
        if (relocating.length) {
          v.banner = { type: 'warning', text: 'Nothing was shipped. ' + relocating.length + (relocating.length === 1 ? ' of these pieces is a fixed asset' : ' of these pieces are fixed assets')
            + ' whose maintenance asset moves to the delivery location in Fusion when it ships. That writes to Fusion: ship them in New EquipRite.' };
          return;
        }

        const shipBatch = await lineBody.updateLines(context, Actions, {
          requestId: Number(requestId),
          headers: cu.auditHeaders(context),
          updates: toShip.map((l) => ({ id: Number(l.id), lineStatus: 'SHIP_TO_SITE' })),
        });
        let ok = 0;
        const failed = [];
        if (shipBatch.ok) {
          ok = toShip.length;
        } else {
          console.warn('[shipChain] ship batch failed, no line changed:', shipBatch.message);
          toShip.forEach((l) => failed.push(Number(l.id)));
        }

        let assetSync = null;
        try {
          const failedIds = new Set(failed.map(String));
          assetSync = await maintAssetLocation.relocateShippedAssets(context, Actions, {
            requestId: Number(requestId),
            lines: toShip.filter((l) => !failedIds.has(String(l.id))),
          });
        } catch (e) {
          console.warn('[shipChain] maintenance-asset sync threw:', e);
        }
        const assetNote = (assetSync && !assetSync.dryRun && assetSync.failed)
          ? ' ' + assetSync.failed + ' maintenance asset(s) could not be relocated in Fusion: the equipment still shipped; update the asset location in Fusion.' : '';

        v.banner = failed.length
          ? { type: 'error', text: 'Nothing was shipped: ' + (shipBatch.message || 'the lines could not be updated.') + ' Try again, or open the request.' }
          : { type: assetNote ? 'warning' : 'confirmation', text: ok + (ok === 1 ? ' piece' : ' pieces') + ' marked shipped to site.' + assetNote };

        if (ok) requestData.invalidate();
        await Actions.callChain(context, { chain: 'openWorkChain', params: { id: String(v.openId), keepBanner: true } });
        if (ok) await Actions.callChain(context, { chain: 'refreshRowChain', params: { id: String(v.openId) } });
      } catch (e) {
        console.error('[shipChain] failed:', e);
        v.banner = { type: 'error', text: 'Pick and ship was interrupted (' + ((e && e.message) || e) + '). Refresh to see where the pieces stand.' };
      } finally {
        v.busy = '';
      }
    }
  }

  return shipChain;
});
