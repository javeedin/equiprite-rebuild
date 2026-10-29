define([
  'vb/action/actionChain',
  'vb/action/actions',
  'vb/action/actionUtils',
  'resources/js/analyticsData',
], (
  ActionChain,
  Actions,
  ActionUtils,
  analyticsData
) => {
  'use strict';

  class vbEnterChain extends ActionChain {

    /**
     * Initial load. The four tab grids bind SDPs and fetch themselves, so this
     * chain only:
     *   1. seeds the Utilization date window (fromDate/toDate are REQUIRED), and
     *   2. fetches the KPI roll-up (yard-stock?groupBy=unitStatus) for the tiles.
     *
     * Static tab definitions live in $page.variables defaults; the old mock
     * KPI/filter/chart seeding is gone (data is live via SDP).
     */
    async run(context) {
      const { $page } = context;

      // Seed the Utilization window — yard-utilization requires fromDate/toDate.
      // Same call shape as FiltersChangedChain so the two cannot drift; on enter
      // the preset is always the default, so the custom pair is empty here.
      const win = analyticsData.periodToWindow(
        $page.variables.utilDatePreset,
        null,
        $page.variables.utilCustomFrom,
        $page.variables.utilCustomTo
      );
      $page.variables.utilFromDate = win.fromDate;
      $page.variables.utilToDate   = win.toDate;

      // Load the active tab. loadActiveTab now sets the KPI tiles too (from the
      // same unitStatus-groups call it uses for the dropdown/donut), so there's
      // no separate fetchKpis here — avoids a duplicate yard-stock call.
      await analyticsData.loadActiveTab($page, context, Actions);
    }
  }

  return vbEnterChain;
});
