define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/analyticsData',
], (ActionChain, Actions, analyticsData) => {
  'use strict';

  // Opens Analytics. From the old vbEnterChain: seed the Utilization window (yard-utilization REQUIRES
  // fromDate/toDate) with the same periodToWindow call, then load the active report.
  //
  // New here: the live reports load only for a role that holds EQR_ANALYTICS (the old page had no access check;
  // FDD 7.15.23 "each person sees only the reports their role allows"). A role with only EQR_REPORTS sees the
  // library, whose reports open in Old EquipRite. The decision waits briefly for page access, as My requests waits
  // for the roles.
  const TRIES = 60;
  const GAP_MS = 50;

  class analyticsInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const av = $application.variables;
      const v = $page.variables;
      for (let i = 0; i < TRIES && !av.pageAccessLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      const can = !!$application.functions.navVisible(av.pageAccessMap, av.pageAccessLoaded, 'EQR_ANALYTICS');
      v.canAnalytics = can;
      if (!can) {
        v.isLoading = false;
        v.isBusy = false;
        return;
      }

      // ?report=<id> opens one of the four directly (links from Home and the library).
      const wanted = v.report;
      if (wanted && $page.functions.liveReports().some((r) => r.id === wanted)) {
        v.analyticsActiveTab = wanted;
      }
      v.analyticsSuggestionFilters = analyticsData.suggestionFiltersFor(v.analyticsActiveTab);

      const win = analyticsData.periodToWindow(v.utilDatePreset, null, v.utilCustomFrom, v.utilCustomTo);
      v.utilFromDate = win.fromDate;
      v.utilToDate = win.toDate;

      await Actions.callChain(context, { chain: 'loadReportChain' });
    }
  }

  return analyticsInitChain;
});
