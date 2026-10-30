define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/maintAssetLocation',
  'resources/js/requestLineBody',
  'resources/js/currentUser',
  'resources/js/requestData',
  'resources/js/rules',
  'resources/js/yardWork',
  'resources/js/mobileBus',
  'resources/js/mobilePick',
  'resources/js/offlineSnapshot',
], (ActionChain, Actions, maintAssetLocation, lineBody, cu, requestData, rules, yw, bus, mp, snapshot) => {
  'use strict';

  // Pick and ship: PICK_INITIATED -> SHIP_TO_SITE, once the pieces have left the yard. Next's shipChain (New's
  // ShipConfirmStuckLinesChain), with the same calls in the same order and the same guards:
  //   1. GET equipment-requests/{id}/lines?size=2000          the live statuses (never the pick list's copy)
  //   2. PATCH equipment-requests/{id}/lines/batch            { lines: [{ id, lineStatus: 'SHIP_TO_SITE' }] }, one
  //      transaction, for the single ticked transfer order's lines at Pick initiated (every line at Pick initiated when
  //      no single order is ticked) plus the fixed-asset lines at Pick initiated (the ticked ones, or all of them)
  //   3. maintAssetLocation.relocateShippedAssets             (copied unchanged) for what shipped
  //   4. the pick list read again (openWorkChain), and the request's card (refreshRowChain)
  // Next's guard: a ship that would move a maintenance asset in Fusion (MAINT_ASSET_LOCATION_SYNC_ENABLED on, a line
  // maintenance tracked and not transactable) is not started here (nothing is written) and is left to New EquipRite.
  // Mobile's own, before the write: no connection, nothing is sent (said so); a pick list shown from this phone's copy
  // is read afresh first; and what is sent is what the Ship sheet said: when the live statuses would ship other pieces
  // than the sheet listed, nothing is sent and the pick list is read again. After it: what shipped leaves the ticks kept
  // on this phone, a toast, the Pick tab's count, and back to the list.
  function sameSet(a, b) {
    const x = (a || []).map(String).sort();
    const y = (b || []).map(String).sort();
    return x.length === y.length && x.every((id, i) => id === y[i]);
  }

  class shipChain extends ActionChain {
    async run(context, { warm } = {}) {
      const { $application } = context;
      const v = context.$page.variables;
      if (warm || v.busy) return;
      if (rules.pageAccess($application.variables.pageAccessMap, $application.variables.pageAccessLoaded, 'EQR_INITIATE_PICKING') !== 'FULL') {
        v.banner = { type: 'error', text: 'Your role cannot ship equipment.' };
        v.sheet = '';
        return;
      }
      const req = v.work.req;
      const requestId = req && (req.eqrEquipmentRequestId || req.id);
      if (!requestId) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        bus.toast('No connection: nothing was sent.', 'warning');
        return;
      }
      if (v.workSaved) {
        v.banner = { type: 'warning', text: 'Nothing was shipped: this is the copy saved on this phone. Refresh the request first.' };
        v.sheet = '';
        return;
      }
      const number = req.requestNumber || 'the request';
      const party = req.party || '';
      const expect = v.sheetData && v.sheetData.kind === 'ship' ? (v.sheetData.ids || []).map(String) : null;
      v.busy = 'ship';
      v.banner = { type: '', text: '' };
      let shipped = 0;
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

        // Mobile's guard: what is shipped is what the sheet said.
        if (expect && !sameSet(expect, toShip.map((l) => l.id))) {
          v.banner = { type: 'warning', text: 'Nothing was shipped: the pieces of ' + number + ' have changed since it was opened (the server would ship '
            + toShip.length + (toShip.length === 1 ? ' piece' : ' pieces') + ', the sheet said ' + expect.length + '). Check the list again, then ship.' };
          await Actions.callChain(context, { chain: 'openWorkChain', params: { id: String(v.openId), keepBanner: true } });
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
        if (ok) {
          shipped = ok;
          const user = cu.auditActor(context) || ($application.user || {}).username || '';
          // What shipped is no longer ticked (the pick list was read again); ticks left over, if any, are still not sent.
          const left = (v.ticks || []).map(String);
          mp.keep(snapshot, user, (k, at) => mp.withTicks(k, String(v.openId), number, left, left.length ? undefined : false, at));
          bus.toast(ok + (ok === 1 ? ' piece' : ' pieces') + ' of ' + number + (party ? ' shipped to ' + party + '.' : ' shipped to site.') + assetNote,
            assetNote ? 'warning' : 'info');
          bus.badge('pick', mp.left(v.items));
        }
      } catch (e) {
        console.error('[shipChain] failed:', e);
        v.banner = { type: 'error', text: 'Pick and ship was interrupted (' + ((e && e.message) || e) + '). Refresh to see where the pieces stand.' };
      } finally {
        v.busy = '';
        v.sheet = '';
      }
      if (shipped) await Actions.callChain(context, { chain: 'closeWorkChain' });
    }
  }

  return shipChain;
});
