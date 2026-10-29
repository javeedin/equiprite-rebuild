define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Page guard for the PROJECTS_MODULE_ENABLED module licence.
  //
  // Runs FIRST on vbEnter (before the page's own init). If the Projects module
  // is off, redirects home and returns so the page never renders. This catches
  // deep-links, bookmarks and browser history that bypass the hidden nav —
  // hiding a menu item removes the affordance, not the route.
  //
  // FAILS CLOSED: while flags are still loading (flagsLoaded false)
  // getHomeTarget() resolves to the customer dashboard, so an unlicensed page
  // is never shown on a slow load. Destination is owned by getHomeTarget(),
  // never re-derived here.
  //
  // This is the UX layer only. The backend must independently reject
  // project-scoped calls — a guard in the browser is advisory.
  //
  // Reads $application.variables directly (JS context), unlike the HTML
  // bindings which must pass the map/loaded flag into isFeatureEnabled().
  class projectsModuleGuardChain extends ActionChain {
    async run(context) {
      const { $application } = context;

      const home = $application.functions.getHomeTarget(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded
      );

      // Projects licensed → getHomeTarget() returns the project dashboard.
      // Anything else means the module is off (or flags are still loading).
      const projectsOff = home.page !== 'main-equiprite';

      // TIMESHEETS_ENABLED — the second gate, independent of the module licence.
      // Projects can be ON while timesheets are switched off (the app then bills
      // on the complete request period and ignores hours), so this page must be
      // unreachable in that state too. The Time Keeper nav section is hidden on
      // the same pair of flags; this is the matching route guard, because hiding
      // a menu item removes the affordance, not the URL.
      // isFeatureEnabled fails CLOSED — treated as off while flags load.
      const timesheetsOff = !$application.functions.isFeatureEnabled(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded,
        'TIMESHEETS_ENABLED'
      );

      if (!projectsOff && !timesheetsOff) {
        return;
      }

      await Actions.fireNotificationEvent(context, {
        summary: 'Module unavailable',
        message: projectsOff
          ? 'Equipment for Projects is not enabled.'
          : 'Timesheets are not enabled.',
        displayMode: 'transient',
        type: 'warning'
      });

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

  return projectsModuleGuardChain;
});
