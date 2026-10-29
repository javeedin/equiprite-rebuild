define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/analyticsData',
], (ActionChain, Actions, analyticsData) => {
  'use strict';

  // Utilization period (the old FiltersChangedChain): preset or custom dates -> analyticsData.periodToWindow ->
  // utilFromDate / utilToDate, bump the filter version, reload. One difference: picking Custom before both dates
  // are filled does not reload (the old chain reloaded the 30-day fallback window in between).
  class periodChain extends ActionChain {
    /**
     * @param {Object} context
     * @param {Object} params
     * @param {string} [params.preset] last-30 | last-90 | ytd | custom
     * @param {string} [params.from]   custom start, yyyy-mm-dd
     * @param {string} [params.to]     custom end, yyyy-mm-dd
     */
    async run(context, { preset, from, to }) {
      const { $page } = context;
      const v = $page.variables;
      if (preset) v.utilDatePreset = preset;
      if (from !== undefined && from !== null) v.utilCustomFrom = String(from);
      if (to !== undefined && to !== null) v.utilCustomTo = String(to);
      if (v.utilDatePreset === 'custom' && !(v.utilCustomFrom && v.utilCustomTo)) {
        return;
      }
      const win = analyticsData.periodToWindow(v.utilDatePreset, null, v.utilCustomFrom, v.utilCustomTo);
      if (win.fromDate === v.utilFromDate && win.toDate === v.utilToDate && v.loadedTab === v.analyticsActiveTab) {
        return;
      }
      v.utilFromDate = win.fromDate;
      v.utilToDate = win.toDate;
      v.analyticsFilterVersion = (v.analyticsFilterVersion || 0) + 1;
      await Actions.callChain(context, { chain: 'loadReportChain' });
    }
  }

  return periodChain;
});
