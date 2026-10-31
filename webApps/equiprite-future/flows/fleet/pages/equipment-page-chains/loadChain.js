define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/equipment360',
  'resources/js/availability',
  'resources/js/nav',
  'resources/js/shellBus',
], (ActionChain, Actions, e3, av, nav, bus) => {
  'use strict';

  // Opens the equipment's tab, and Refresh. Reads only (equipment360.js names every call):
  //   1. the item, its units and its bookings (loadCore): the head, the units and the availability ahead show, and the
  //      tab is named after it;
  //   2. the rest of its history and Fusion's planned maintenance (loadMore), at most eight reads at once: the history
  //      fills in (newest first) and the maintenance bars are drawn.
  // A read that fails leaves its part out and is named on the page. Nothing is kept beyond the page.
  class loadChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const seq = (v.loadSeq || 0) + 1;
      v.loadSeq = seq;
      v.isLoading = true;
      v.error = '';
      const params = { name: v.name || '', equipmentId: v.equipmentId || '', serial: v.serial || '', unit: v.unit || '' };
      const key = nav.RECORDS['equipment-360'].key(params);
      v.key = key;
      v.uid = String(key).replace(/[^A-Za-z0-9_-]/g, '_') || 'x';
      const today = av.todayKey();
      if (!v.from || !v.to) {
        v.from = today;
        v.to = av.addDays(today, e3.WINDOW_DAYS - 1);
      }
      const chip = (v.hv && v.hv.chip) || 'all';
      v.hist = { loading: true, events: [], chips: [], note: '', failed: '', count: 0 };
      const call = (o) => Actions.callRest(context, o);

      let core;
      try {
        core = await e3.loadCore(call, params);
      } catch (e) {
        console.error('[equipment loadChain] failed', e);
        core = { error: 'This equipment could not be loaded.' };
      }
      if (v.loadSeq !== seq) return;
      if (core.error) {
        v.error = core.error;
        v.isLoading = false;
        v.hist = { loading: false, events: [], chips: [], note: '', failed: '', count: 0 };
        v.hv = { chip: 'all', rows: [] };
        return;
      }
      const opts = () => ({ from: v.from, to: v.to, mode: core.mode, yards: core.yards });
      let model = e3.modelOf(core, {}, today);
      let view = e3.view(model, opts());
      const hasAssets = (core.serials || []).some((s) => s && s.maintenanceAssetNumber)
        || !!(core.mode === 'item' && core.master && core.master.maintenanceAssetNumber);
      v.mode = core.mode;
      v.yards = core.yards;
      v.notes = core.notes;
      v.model = model;
      v.view = view;
      v.head = e3.headOf(core, model, view.units);
      v.maint = hasAssets ? 'loading' : 'none';
      v.isLoading = false;
      this.rename(params, v.head.tabTitle);
      // The bookings are known already: shown while the rest of the history is read.
      const early = e3.historyOf(core, {}, today);
      const earlyChip = early.chips.some((c) => c.key === chip) ? chip : 'all';
      v.hist = Object.assign({}, early, { loading: true, failed: '', note: '' });
      v.hv = { chip: earlyChip, rows: e3.shown(early.events, earlyChip) };

      let more;
      try {
        more = await e3.loadMore(call, core);
      } catch (e) {
        console.warn('[equipment loadChain] the rest of the history could not be read', e);
        more = { failed: ['the rest of its history (status changes, transfers, inspections, maintenance, certificates, documents)'], woFailed: hasAssets };
      }
      if (v.loadSeq !== seq) return;
      if (more.workOrders && Object.keys(more.workOrders).length) {
        model = e3.modelOf(core, more.workOrders, today);
        view = e3.view(model, opts());
        v.model = model;
        v.view = view;
        v.head = e3.headOf(core, model, view.units);
      }
      v.maint = hasAssets ? (more.woFailed ? 'partial' : 'ready') : 'none';
      const hist = e3.historyOf(core, more, today);
      const keep = (v.hv && v.hv.chip) || chip;
      const on = hist.chips.some((c) => c.key === keep) ? keep : 'all';
      v.hist = hist;
      v.hv = { chip: on, rows: e3.shown(hist.events, on) };
    }

    /** Names the tab after the equipment: the record's own tab, and the unit record's when it was opened as one. */
    rename(params, title) {
      if (!title) return;
      bus.rename('equipment-360:' + nav.RECORDS['equipment-360'].key(params), title);
      if (params.unit && nav.RECORDS.unit) {
        const k = nav.RECORDS.unit.key ? nav.RECORDS.unit.key(params) : params.unit;
        if (k) bus.rename('unit:' + k, title);
      }
    }
  }

  return loadChain;
});
