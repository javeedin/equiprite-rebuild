define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/usageGuard',
], (ActionChain, Actions, usageGuard) => {
  'use strict';

  // Opens Timesheet approval: the feature guard (the old projectsModuleGuardChain), the role's read-only state,
  // then the lines (loadApprovalsChain) on ?week= or the newest week with lines waiting.
  class approvalInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      if (!(await usageGuard.allow(context, Actions))) {
        return;
      }
      const fns = $application.functions;
      const vars = $application.variables;
      $page.variables.readOnly = !!fns.isPageReadOnly(vars.pageAccessMap, vars.pageAccessLoaded, 'EQR_TIMESHEET_APPROVALS');
      $page.variables.ppmOn = !!fns.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, 'PPM_RATES_ENABLED');
      await Actions.callChain(context, { chain: 'loadApprovalsChain', params: { week: $page.variables.week || '' } });
    }
  }

  return approvalInitChain;
});
