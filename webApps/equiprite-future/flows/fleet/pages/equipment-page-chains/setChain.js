define([
  'vb/action/actionChain',
  'resources/js/equipment360',
  'resources/js/availability',
], (ActionChain, e3, av) => {
  'use strict';

  // A choice changed: the window (a date or a quick window), the history's unit chip, or the export menu. Nothing is
  // read or written; the units, the answer and the timeline are worked out again in one go.
  class setChain extends ActionChain {
    async run(context, { field, value }) {
      const { $page } = context;
      const v = $page.variables;
      const val = value == null ? '' : String(value);
      if (field === 'exportOpen') { v.exportOpen = !v.exportOpen; return; }
      if (field === 'chip') {
        const hist = v.hist || {};
        const chip = val || 'all';
        v.hv = { chip, rows: e3.shown(hist.events, chip) };
        return;
      }
      if (field !== 'from' && field !== 'to' && field !== 'preset') return;
      const today = (v.model && v.model.today) || av.todayKey();
      let from = v.from;
      let to = v.to;
      if (field === 'preset') {
        from = today;
        to = av.addDays(today, Math.max(1, Number(val) || e3.WINDOW_DAYS) - 1);
      } else {
        // A cleared date box changes nothing.
        if (!av.d10(val)) return;
        if (field === 'from') from = val; else to = val;
      }
      const win = av.windowOf(from, to, today);
      v.from = win.from;
      v.to = win.to;
      v.exportOpen = false;
      if (v.model) v.view = e3.view(v.model, { from: win.from, to: win.to, mode: v.mode, yards: v.yards });
      $page.functions.syncDates(v.uid, win.from, win.to);
    }
  }

  return setChain;
});
