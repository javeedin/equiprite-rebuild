define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class onSelectedKpiChangedChain extends ActionChain {

    async run(context, { kpiId }) {
      const { $application } = context;

      const navigationMap = {
        'active-requests':  'customer-my-requests',
        'on-site':          'customer-my-requests',
        'pending-invoices': 'customer-my-billing',
        'browse-catalog':   'request-catalog'
      };

      const target = navigationMap[kpiId];
      if (!target) {
        return;
      }

      // The billing tile is hidden when EXTERNAL_PROJECT_ASSIGN_ENABLED is on
      // (external requests bill through the assigned internal project), but a
      // KPI id can still arrive from a stale binding or a re-fired event, so the
      // route is checked here too rather than trusting the tile's absence.
      // Same isFeatureFlagOff() accessor as the tile and the page guard.
      if (target === 'customer-my-billing'
          && !$application.functions.isFeatureFlagOff(
               $application.variables.featureFlags,
               $application.variables.flagsLoaded,
               'EXTERNAL_PROJECT_ASSIGN_ENABLED')) {
        return;
      }

      await Actions.navigateToPage(context, { page: target });
    }
  }

  return onSelectedKpiChangedChain;
});
