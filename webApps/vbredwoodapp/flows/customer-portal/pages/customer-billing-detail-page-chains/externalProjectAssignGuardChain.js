define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Withdraws the customer billing screen when EXTERNAL_PROJECT_ASSIGN_ENABLED
  // is ON.
  //
  // WHY ON, not off: with that flag on, an external request is attributed to an
  // internal project and costed through it (see the flag's rationale in
  // configurations-page.html and request-detail-page's Assign Project drawer).
  // Billing then belongs to the project, so the customer-facing "My Billing"
  // screen no longer describes how the request is billed and is withdrawn
  // rather than shown with figures that do not apply.
  //
  // This is an INVERSE gate, which is why it calls isFeatureFlagOff() and not
  // !isFeatureEnabled(). isFeatureEnabled fails closed — false while flags load
  // — so negating it would read "still loading" as "flag is off" and admit the
  // page for the first moments of a slow load, exactly when a deep link is most
  // likely to be resolving. isFeatureFlagOff requires flagsLoaded before it
  // answers true, so an unresolved flag redirects. Same accessor backs
  // visibleNavGroups' hiddenWhenFlags, so the hidden nav entry and this guard
  // can never disagree about whether the page exists.
  //
  // Runs on vbEnter AFTER customersModuleGuardChain (module licence first, then
  // this feature gate) and BEFORE the page's own init, so the page never
  // fetches billing data it is not going to show.
  //
  // Destination comes from getRoleHomeTarget(), the RBAC-aware wrapper, never
  // re-derived here: a customer-only role must not be sent to the project
  // dashboard it cannot open. It falls back to getHomeTarget internally when
  // RBAC has not loaded.
  //
  // UX layer only. The backend must independently reject customer billing
  // calls — a guard in the browser is advisory.
  class externalProjectAssignGuardChain extends ActionChain {
    async run(context) {
      const { $application } = context;

      const allowed = $application.functions.isFeatureFlagOff(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded,
        'EXTERNAL_PROJECT_ASSIGN_ENABLED'
      );
      if (allowed) {
        return;
      }

      await Actions.fireNotificationEvent(context, {
        summary: 'Billing unavailable',
        message: 'Billing for external requests is handled through the assigned project.',
        displayMode: 'transient',
        type: 'warning'
      });

      const home = $application.functions.getRoleHomeTarget(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded,
        $application.variables.pageAccessMap,
        $application.variables.pageAccessLoaded
      );

      // target:'parent' — this page sits in a sub-flow and the destination is a
      // sibling flow; without it VB resolves the flow name relative to the
      // current one and 404s. Mirrors customersModuleGuardChain.
      await Actions.navigateToFlow(context, {
        flow: home.flow,
        page: home.page,
        target: 'parent'
      });
    }
  }

  return externalProjectAssignGuardChain;
});
