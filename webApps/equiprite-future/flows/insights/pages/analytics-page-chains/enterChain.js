define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rules',
  'resources/js/analyticsData',
  'resources/js/insightsModel',
], (ActionChain, Actions, rules, analyticsData, model) => {
  'use strict';

  // Opens Analytics. As New EquipRite's analyticsInitChain: wait briefly for page access, then decide what this role
  // may see (the fleet, utilization, late and request questions need EQR_ANALYTICS; cost, a report of Old
  // EquipRite's Reports page, needs EQR_REPORTS), seed the utilization window with the same periodToWindow call
  // (yard-utilization needs fromDate and toDate), and load the first question. Reads only.
  const TRIES = 60;
  const GAP_MS = 50;

  class enterChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const av = $application.variables;
      const v = $page.variables;
      for (let i = 0; i < TRIES && !av.pageAccessLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      v.canAnalytics = rules.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_ANALYTICS') !== 'HIDDEN';
      v.canReports = rules.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_REPORTS') !== 'HIDDEN';
      v.reports = model.reportsFor(v.canAnalytics, v.canReports);
      v.accessChecked = true;
      if (!v.reports.length) {
        v.isLoading = false;
        return;
      }
      const u = v.f.use;
      v.win = analyticsData.periodToWindow(u.preset, null, u.from, u.to);
      v.report = v.reports[0].key;
      await Actions.callChain(context, { chain: 'loadChain', params: { report: v.report } });
    }
  }

  return enterChain;
});
