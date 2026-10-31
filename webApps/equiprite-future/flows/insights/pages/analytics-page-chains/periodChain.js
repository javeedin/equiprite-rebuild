define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/analyticsData',
], (ActionChain, Actions, analyticsData) => {
  'use strict';

  // The utilization period (New EquipRite's periodChain): a preset or custom dates -> analyticsData.periodToWindow ->
  // the window, then reload. As in New, picking Custom before both dates are filled does not reload, and the same
  // window again does nothing.
  class periodChain extends ActionChain {
    async run(context, { preset, from, to }) {
      const v = context.$page.variables;
      const u = Object.assign({}, v.f.use);
      if (preset) u.preset = preset;
      if (from !== undefined && from !== null) u.from = String(from);
      if (to !== undefined && to !== null) u.to = String(to);
      v.f = Object.assign({}, v.f, { use: u });
      if (u.preset === 'custom' && !(u.from && u.to)) return;
      const win = analyticsData.periodToWindow(u.preset, null, u.from, u.to);
      if (win.fromDate === v.win.fromDate && win.toDate === v.win.toDate && v.loaded.use) return;
      v.win = win;
      await Actions.callChain(context, { chain: 'loadChain', params: { report: 'use', refresh: true } });
    }
  }

  return periodChain;
});
