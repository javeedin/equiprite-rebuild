define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/availability',
  'resources/js/availabilityData',
  'resources/js/requestData',
], (ActionChain, Actions, av, data, requestData) => {
  'use strict';

  // Loads the fleet and its bookings (New EquipRite's schedule calls, availabilityData.js) with the requests and
  // their lines (requestData, shared with Requests and the bell, for where each booking is on its journey), draws
  // the page, then reads planned maintenance from Fusion and draws it again. Reads only.
  class loadChain extends ActionChain {
    async run(context, { refresh }) {
      const v = context.$page.variables;
      const seq = (v.loadSeq || 0) + 1;
      v.loadSeq = seq;
      v.isLoading = true;
      v.error = '';
      const today = av.todayKey();
      if (!v.from || !v.to) {
        v.from = today;
        v.to = av.addDays(today, 13);
      }
      if (!v.viewStart) {
        const fit = av.fitView(av.windowOf(v.from, v.to, today), v.zoom);
        v.zoom = fit.zoom;
        v.viewStart = fit.viewStart;
      }
      const call = (o) => Actions.callRest(context, o);
      let core;
      let reqs;
      try {
        [core, reqs] = await Promise.all([
          data.loadCore(call),
          requestData.load(context, Actions, { refresh: !!refresh }),
        ]);
      } catch (e) {
        console.error('[availability] load failed', e);
        if (v.loadSeq === seq) {
          v.error = 'Availability could not be loaded.';
          v.isLoading = false;
        }
        return;
      }
      if (v.loadSeq !== seq) return;

      const input = {
        serials: core.serials, classes: core.classes, lines: core.lines, masterById: core.masterById, locationsById: core.locationsById,
        requests: reqs.rows || [], linesByRequest: reqs.linesByRequest || {}, workOrdersByAsset: {},
      };
      const notes = core.notes.slice();
      if (reqs.error || !reqs.linesLoaded) {
        notes.push('Where each booking is on its journey could not be read for every request: those bars are coloured from their allocation.');
      }
      const hasAssets = core.serials.some((s) => s && s.maintenanceAssetNumber);
      const model = av.build(input, today);
      v.error = core.error;
      v.notes = notes;
      v.yards = av.yards(model);
      v.maint = hasAssets ? 'loading' : 'none';
      v.model = model;
      v.isLoading = false;
      await Actions.callChain(context, { chain: 'applyChain' });
      if (!hasAssets) return;

      // Planned maintenance arrives a moment later: one Fusion lookup per maintenance asset, eight at a time.
      let wo;
      try {
        wo = await data.workOrders(call, core.serials);
      } catch (e) {
        console.warn('[availability] planned maintenance could not be read', e);
        wo = { byAsset: {}, failed: 1 };
      }
      if (v.loadSeq !== seq) return;
      v.model = av.build(Object.assign({}, input, { workOrdersByAsset: wo.byAsset }), today);
      v.maint = wo.failed ? 'partial' : 'ready';
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return loadChain;
});
