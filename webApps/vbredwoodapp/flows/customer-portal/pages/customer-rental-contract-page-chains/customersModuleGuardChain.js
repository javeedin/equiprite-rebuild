define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Page guard for the CUSTOMERS_MODULE_ENABLED module licence.
  // Mirror of projectsModuleGuardChain — see that file for the shared rationale.
  //
  // Runs FIRST on vbEnter (before the page's own init). If the Customers module
  // is off, redirects home and returns so the page never renders. This catches
  // deep-links, bookmarks and browser history that bypass the hidden nav —
  // hiding a menu item removes the affordance, not the route.
  //
  // Destination is owned by getHomeTarget(), never re-derived here. Under the
  // one-module-off invariant, Customers being off means Projects is on, so home
  // is the project dashboard.
  //
  // FAILS CLOSED: isFeatureEnabled() returns false while flags are still
  // loading, so an unlicensed page is never shown on a slow load. The cost is a
  // redirect that a late-arriving 'true' would have avoided; the page's own
  // guard re-runs on re-entry.
  //
  // This is the UX layer only. The backend must independently reject
  // customer-scoped calls — a guard in the browser is advisory.
  class customersModuleGuardChain extends ActionChain {
    async run(context) {
      const { $application } = context;

      const enabled = $application.functions.isFeatureEnabled(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded,
        'CUSTOMERS_MODULE_ENABLED'
      );
      if (enabled) {
        return;
      }

      await Actions.fireNotificationEvent(context, {
        summary: 'Module unavailable',
        message: 'Equipment for Customers is not enabled.',
        displayMode: 'transient',
        type: 'warning'
      });

      const home = $application.functions.getHomeTarget(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded
      );

      // target:'parent' — this page sits in a sub-flow and the destination is a
      // sibling flow; without it VB resolves the flow name relative to the
      // current one and 404s.
      await Actions.navigateToFlow(context, {
        flow: home.flow,
        page: home.page,
        target: 'parent'
      });
    }
  }

  return customersModuleGuardChain;
});
