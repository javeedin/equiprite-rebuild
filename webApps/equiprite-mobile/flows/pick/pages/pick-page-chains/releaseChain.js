define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser',
  'resources/js/requestData',
  'resources/js/rules',
  'resources/js/yardWork',
  'resources/js/mobileBus',
  'resources/js/mobilePick',
  'resources/js/offlineSnapshot',
], (ActionChain, Actions, lineBody, cu, requestData, rules, yw, bus, mp, snapshot) => {
  'use strict';

  // Release for picking, for fixed-asset (F&M) pieces only: they have no transfer order, so the release is EquipRite's
  // own status change. Next's releaseChain (New's ReleaseTransferOrderChain, F&M branch), the same call and guards:
  //   PATCH equipment-requests/{id}/lines/batch   { lines: [{ id, lineStatus: 'PICK_INITIATED' }] }   one transaction
  // for the ticked F&M lines still waiting for release (SCHEDULED_FOR_PICKING, or ALLOCATED), then the lines move in
  // place. Nothing else is sent. Lines on a transfer order are released through OIC in Fusion: not done here (New).
  // Mobile's own, before the write: no connection, nothing is sent (said so); a pick list shown from this phone's copy
  // is read afresh first. After it: the released pieces are no longer ticked (they are ticked again when picked), a
  // toast, the Pick tab's count.
  const RELEASABLE_FM_STATUSES = ['SCHEDULED_FOR_PICKING', 'ALLOCATED'];

  class releaseChain extends ActionChain {
    async run(context, { warm } = {}) {
      const { $application } = context;
      const v = context.$page.variables;
      if (warm || v.busy) return;
      if (rules.pageAccess($application.variables.pageAccessMap, $application.variables.pageAccessLoaded, 'EQR_INITIATE_PICKING') !== 'FULL') {
        v.banner = { type: 'error', text: 'Your role cannot release equipment for picking.' };
        v.sheet = '';
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        bus.toast('No connection: nothing was sent.', 'warning');
        return;
      }
      if (v.workSaved) {
        v.banner = { type: 'warning', text: 'Nothing was released: this is the copy saved on this phone. Refresh the request first.' };
        v.sheet = '';
        return;
      }
      const picked = yw.selectedLines(v.work.lines, v.ticks);
      const fmPicked = picked.filter((l) => l && l.isFAndM === true);
      const stPicked = picked.filter((l) => !l || l.isFAndM !== true);
      const stNote = stPicked.length
        ? ' The ticked transfer-order pieces were left as they are: their release goes through Fusion, in New EquipRite.' : '';
      if (!fmPicked.length) {
        v.banner = { type: 'warning', text: 'Tick the fixed-asset pieces to release.' + stNote };
        v.sheet = '';
        return;
      }
      const req = v.work.req;
      const requestId = req && (req.eqrEquipmentRequestId || req.id);
      const number = (req && req.requestNumber) || 'the request';
      if (!requestId) {
        v.banner = { type: 'error', text: 'Could not tell which request this is: close it and open it again.' };
        v.sheet = '';
        return;
      }
      v.banner = { type: '', text: '' };
      v.busy = 'release';
      let released = 0;
      try {
        const eligible = fmPicked.filter((l) => RELEASABLE_FM_STATUSES.indexOf(String(l.lineStatus || '').toUpperCase()) !== -1);
        if (!eligible.length) {
          v.banner = { type: 'warning', text: 'None of the ticked fixed-asset pieces is waiting for release. Only pieces scheduled for picking can be released; '
            + 'those being picked are ready for Pick and ship.' + stNote };
          return;
        }
        const fmBatch = await lineBody.updateLines(context, Actions, {
          requestId: Number(requestId),
          headers: cu.auditHeaders(context),
          updates: eligible.map((l) => ({ id: Number(l.lineId), lineStatus: 'PICK_INITIATED' })),
        });
        if (!fmBatch.ok) {
          console.warn('[releaseChain] F&M release batch failed, no line changed:', fmBatch.message);
          v.banner = { type: 'error', text: 'Nothing was released: ' + (fmBatch.message || 'the lines could not be updated.') + ' Try Refresh first.' + stNote };
          return;
        }
        const okIds = new Set(eligible.map((l) => String(l.lineId)));
        v.work = Object.assign({}, v.work, {
          lines: (v.work.lines || []).map((l) => (okIds.has(String(l.lineId)) ? Object.assign({}, l, { lineStatus: 'PICK_INITIATED' }) : l)),
        });
        released = eligible.length;
        // Mobile: a released piece is ticked again when it has been picked.
        const work = v.work;
        const ticks = mp.afterRelease(v.ticks, Array.from(okIds));
        const selectedTOId = yw.selectedTOIdFor(work.tos, work.lines, ticks);
        v.selectedTOId = selectedTOId;
        v.ticks = ticks;
        v.check = mp.checklist(work, ticks, selectedTOId, { syncOn: v.can.sync, external: work.req && work.req.isCustomer });
        v.banner = { type: 'confirmation', text: released + ' fixed-asset '
          + (released === 1 ? 'piece' : 'pieces') + ' released for picking. They have no transfer order: Pick and ship them once they have been picked.' + stNote };
        requestData.invalidate();
        await Actions.callChain(context, { chain: 'refreshRowChain', params: { id: String(v.openId) } });
        const user = cu.auditActor(context) || ($application.user || {}).username || '';
        mp.keep(snapshot, user, (k, at) => mp.withTicks(mp.withWork(k, JSON.parse(JSON.stringify(v.work)), at), String(v.openId), number, ticks, undefined, at));
        bus.toast(released + (released === 1 ? ' piece' : ' pieces') + ' of ' + number + ' released for picking.', 'info');
        bus.badge('pick', mp.left(v.items));
      } catch (e) {
        console.error('[releaseChain] failed', e);
        v.banner = { type: 'error', text: 'The release was interrupted (' + ((e && e.message) || e) + '). Refresh to see where the pieces stand.' };
      } finally {
        v.busy = '';
        v.sheet = '';
      }
    }
  }

  return releaseChain;
});
