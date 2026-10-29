define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Page guard for this page's module licence.
  //
  // DELIBERATELY NOT projectsModuleGuardChain, which the other pages use. Do not
  // "restore" it to match them - this page is genuinely different:
  //
  // Create Request serves BOTH request types. Each module flag owns one
  // (PROJECTS->INTERNAL, CUSTOMERS->EXTERNAL), so the page is licensed when
  // EITHER module is on, and the Customer Type field narrows to whichever type
  // the licence allows (see forcedCustomerType() in app-flow.js).
  //
  // The old Projects-only test broke the Customers-only tenant outright: RBAC
  // routes an equipment manager HERE (app role EQUIP_MGR holds FULL on
  // EQR_PROJ_CREATE_REQUEST and no grant on EQR_CUST_CREATE_REQ), and this guard
  // then bounced them - leaving that role with no reachable create page at all.
  //
  // Runs on vbEnter. If neither module is on, redirects home and returns so the
  // page never renders. This catches deep-links, bookmarks and browser history
  // that bypass the hidden nav - hiding a menu item removes the affordance, not
  // the route.
  //
  // FAILS CLOSED: isFeatureEnabled() returns false until flagsLoaded, so an
  // unlicensed page is never shown on a slow load. Destination is owned by
  // getHomeTarget(), never re-derived here.
  //
  // (updateSettingChain's last-module-standing guard means at least one module
  // is always on, so in practice this admits every real tenant. The check stays
  // because the guard must not depend on an invariant enforced in a different
  // page's save path - and it still fails closed during the load window.)
  //
  // This is the UX layer only. The backend must independently reject requests of
  // an unlicensed type - a guard in the browser is advisory.
  //
  // Reads $application.variables directly (JS context), unlike the HTML
  // bindings which must pass the map/loaded flag into isFeatureEnabled().
  class eitherModuleGuardChain extends ActionChain {
    async run(context) {
      const { $application } = context;

      const flags = $application.variables.featureFlags;
      const loaded = $application.variables.flagsLoaded;

      const licensed =
        $application.functions.isFeatureEnabled(flags, loaded, 'PROJECTS_MODULE_ENABLED')
        || $application.functions.isFeatureEnabled(flags, loaded, 'CUSTOMERS_MODULE_ENABLED');

      if (licensed) {
        return;
      }

      await Actions.fireNotificationEvent(context, {
        summary: 'Module unavailable',
        message: 'Creating equipment requests is not enabled.',
        displayMode: 'transient',
        type: 'warning'
      });

      const home = $application.functions.getHomeTarget(flags, loaded);

      // target:'parent' - this page sits in a sub-flow and the destination is a
      // sibling flow; without it VB resolves the flow name relative to the
      // current one and 404s.
      await Actions.navigateToFlow(context, {
        flow: home.flow,
        page: home.page,
        target: 'parent'
      });
    }
  }

  return eitherModuleGuardChain;
});
