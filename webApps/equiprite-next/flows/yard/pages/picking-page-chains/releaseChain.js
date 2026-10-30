define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/requestLineBody',
  'resources/js/currentUser',
  'resources/js/requestData',
  'resources/js/rules',
  'resources/js/yardWork',
], (ActionChain, Actions, lineBody, cu, requestData, rules, yw) => {
  'use strict';

  // Release for picking, for fixed-asset (F&M) pieces only: they have no transfer order, so the release is EquipRite's
  // own status change. New's ReleaseTransferOrderChain, F&M branch (releaseFAndMLines), unchanged:
  //   PATCH equipment-requests/{id}/lines/batch   { lines: [{ id, lineStatus: 'PICK_INITIATED' }] }   one transaction
  // for the ticked F&M lines still waiting for release (SCHEDULED_FOR_PICKING, or ALLOCATED from before Confirm wrote
  // that), then the lines move in place, as New shows them. Nothing else is sent.
  //
  // Lines on a transfer order are released through OIC in Fusion (reserve + pick release): not done here. They are
  // never moved to Pick initiated by Next; the workspace says so and links to New EquipRite.
  const RELEASABLE_FM_STATUSES = ['SCHEDULED_FOR_PICKING', 'ALLOCATED'];

  class releaseChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      const v = context.$page.variables;
      if (v.busy) return;
      if (rules.pageAccess($application.variables.pageAccessMap, $application.variables.pageAccessLoaded, 'EQR_INITIATE_PICKING') !== 'FULL') {
        v.banner = { type: 'error', text: 'Your role cannot release equipment for picking.' };
        return;
      }
      const picked = yw.selectedLines(v.work.lines, v.ticks);
      const fmPicked = picked.filter((l) => l && l.isFAndM === true);
      const stPicked = picked.filter((l) => !l || l.isFAndM !== true);
      const stNote = stPicked.length
        ? ' The ticked transfer-order pieces were left as they are: their release goes through Fusion, in New EquipRite.' : '';
      if (!fmPicked.length) {
        v.banner = { type: 'warning', text: 'Tick the fixed-asset pieces to release.' + stNote };
        return;
      }
      const req = v.work.req;
      const requestId = req && (req.eqrEquipmentRequestId || req.id);
      if (!requestId) {
        v.banner = { type: 'error', text: 'Could not tell which request this is: close it and open it again.' };
        return;
      }
      v.banner = { type: '', text: '' };
      v.busy = 'release';
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
        v.banner = { type: 'confirmation', text: eligible.length + ' fixed-asset '
          + (eligible.length === 1 ? 'piece' : 'pieces') + ' released for picking. They have no transfer order: Pick and ship them once they have been picked.' + stNote };
        requestData.invalidate();
        await Actions.callChain(context, { chain: 'refreshRowChain', params: { id: String(v.openId) } });
      } catch (e) {
        console.error('[releaseChain] failed', e);
        v.banner = { type: 'error', text: 'The release was interrupted (' + ((e && e.message) || e) + '). Refresh to see where the pieces stand.' };
      } finally {
        v.busy = '';
      }
    }
  }

  return releaseChain;
});
