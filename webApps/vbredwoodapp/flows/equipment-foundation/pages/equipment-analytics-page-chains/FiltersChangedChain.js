define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/analyticsData',
], (
  ActionChain,
  Actions,
  analyticsData
) => {
  'use strict';

  class FiltersChangedChain extends ActionChain {

    /**
     * Fires when the Utilization Period control changes — the preset select, or
     * either date picker when the preset is Custom. Bound via
     * `on-value-changed="[[$listeners.onFilterChanged]]"` on all three controls.
     *
     * The window is the only page-level filter left: everything else on this
     * page is a smart-search chip, handled by OnAnalyticsSmartSearchChangedChain.
     * fromDate/toDate are REQUIRED by the yard-utilization view and are supplied
     * by the page, never by search (see reportCriterion ENDPOINT_PARAMS), which
     * is why this chain owns them.
     */
    async run(context) {
      const { $page } = context;

      // Preset → window. 'custom' passes the two date pickers straight through.
      const win = analyticsData.periodToWindow(
        $page.variables.utilDatePreset,
        null,
        $page.variables.utilCustomFrom,
        $page.variables.utilCustomTo
      );
      $page.variables.utilFromDate = win.fromDate;
      $page.variables.utilToDate   = win.toDate;

      // The utilization grid caches on its row shape, and two windows can share
      // one — bump the version so getUtilizationGridProvider rebuilds. This is
      // the same signal the other three tab grids already take.
      $page.variables.analyticsFilterVersion =
        ($page.variables.analyticsFilterVersion || 0) + 1;

      // Reload the active tab under the new window. loadActiveTab refreshes the
      // KPI tiles too (from its shared unitStatus-groups call), so no separate
      // fetchKpis here — avoids a duplicate yard-stock call per filter change.
      await analyticsData.loadActiveTab($page, context, Actions);
    }
  }

  return FiltersChangedChain;
});
