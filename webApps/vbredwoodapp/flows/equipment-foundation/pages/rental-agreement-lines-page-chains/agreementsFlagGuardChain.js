define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A3 page guard for the AGREEMENTS_ENABLED feature flag.
  //
  // Runs on vbBeforeEnter, NOT vbEnter. That distinction is the whole point: VB
  // runs every chain listed on an event regardless of what the previous one
  // returns, so a guard on vbEnter cannot stop the page's init chain — the
  // redirect fired, but the page still fetched its agreement data on the way
  // out. vbBeforeEnter runs before the page is entered, so navigating away here
  // means vbEnter never runs at all. (This chain used to sit on vbEnter and its
  // comment claimed it "returns true so the caller can stop" — nothing consumed
  // that return value.) This page had no vbBeforeEnter listener at all; one was
  // added for this guard.
  //
  // Catches deep-links / bookmarks that bypass the disabled nav (A2). Fails
  // CLOSED: while flags are still loading (flagsLoaded false) it also redirects,
  // since we can't confirm the feature is on. The backend enforces the hard rule.
  //
  // Reads $application.variables directly (JS context), unlike the HTML bindings
  // which must pass the map/loaded flag into isFeatureEnabled().
  class agreementsFlagGuardChain extends ActionChain {
    async run(context) {
      const { $application } = context;

      // ─── MODULE GUARD (PROJECTS_MODULE_ENABLED) ─────────────────────────
      // ACTIVE. Separate and broader than the AGREEMENTS_ENABLED check below:
      // the module licence decides whether Agreement Manager exists at all,
      // the feature flag decides whether it is usable when it does. The nav
      // section is hidden with the module off, but hiding removes the
      // affordance, not the route — this catches deep-links and bookmarks.
      // FAILS CLOSED via getHomeTarget(), which owns the destination.
      const home = $application.functions.getHomeTarget(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded
      );
      if (home.page !== 'main-equiprite') {
        await Actions.fireNotificationEvent(context, {
          summary: 'Module unavailable',
          message: 'Equipment for Projects is not enabled.',
          displayMode: 'transient', type: 'warning'
        });
        await Actions.navigateToFlow(context, {
          flow: home.flow, page: home.page, target: 'parent'
        });
        return;
      }
      // ────────────────────────────────────────────────────────────────────

      // ─── FEATURE GUARD (AGREEMENTS_ENABLED) ─────────────────────────────
      // RESTORED. Was disabled pending the AGREEMENTS_ENABLED row in
      // EQR_CONF_GLOBAL_SETTINGS; that row now exists, so the guard is live.
      //
      // Catches deep-links and bookmarks that bypass the nav. FAILS CLOSED:
      // while flags are still loading (flagsLoaded false) this also redirects,
      // since we cannot yet confirm the feature is on.
      //
      // Redirects via getHomeTarget() (resolved above) rather than a hardcoded
      // 'main-equiprite', matching the module guard — that helper owns where a
      // blocked user lands, so this cannot drift from it.
      const flags  = $application.variables.featureFlags || {};
      const loaded = $application.variables.flagsLoaded === true;
      if (!(loaded && flags.AGREEMENTS_ENABLED === 'true')) {
        await Actions.fireNotificationEvent(context, {
          summary: 'Feature unavailable',
          message: 'Rental Agreements is disabled by configuration.',
          displayMode: 'transient', type: 'warning'
        });
        await Actions.navigateToFlow(context, {
          flow: home.flow, page: home.page, target: 'parent'
        });
        return;
      }
      return;
    }
  }

  return agreementsFlagGuardChain;
});
