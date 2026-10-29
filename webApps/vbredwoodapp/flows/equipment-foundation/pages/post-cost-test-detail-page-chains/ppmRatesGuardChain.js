define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Withdraws Post Cost when PPM_RATES_ENABLED is ON (requirements R14).
  //
  // Under Fusion PPM rates EquipRite computes no rental cost at all: the
  // expenditure type and its unit go to Fusion, and Fusion prices them from its
  // own rate schedules. Every figure on this page would then be an EquipRite
  // number for something EquipRite is not pricing — worse than absent, because
  // it looks authoritative. R14 says the page does not exist in that mode, not
  // that it is simplified or made read-only.
  //
  // This is an INVERSE gate, so it calls isFeatureFlagOff() and NOT
  // !isFeatureEnabled(). isFeatureEnabled fails closed — false while flags load
  // — so negating it would read "still loading" as "PPM is off" and admit the
  // page for the first moments of a slow load, which is exactly when a deep
  // link is resolving. isFeatureFlagOff requires flagsLoaded before answering
  // true, so an unresolved flag redirects. The same accessor backs
  // visibleNavGroups' hiddenWhenFlags, so the hidden menu entry and this guard
  // cannot disagree about whether the page exists.
  //
  // Runs on vbEnter AFTER projectsModuleGuardChain (module licence first, then
  // this feature gate) and BEFORE the page's own init, so the page never
  // fetches cost data it is not going to show.
  //
  // UX layer only. Nothing below the UI reads this flag yet, and the backend
  // must independently refuse to post EquipRite-priced cost once it does.
  class ppmRatesGuardChain extends ActionChain {
    async run(context) {
      const { $application } = context;

      const allowed = $application.functions.isFeatureFlagOff(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded,
        'PPM_RATES_ENABLED'
      );
      if (allowed) {
        return;
      }

      await Actions.fireNotificationEvent(context, {
        summary: 'Post Cost unavailable',
        message: 'Rates come from Fusion PPM, so cost is calculated and posted there. '
          + 'Turn off Fusion PPM Rates in Configurations to use EquipRite costing.',
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
      // current one and 404s. Mirrors the other guard chains.
      await Actions.navigateToFlow(context, {
        flow: home.flow,
        page: home.page,
        target: 'parent'
      });
    }
  }

  return ppmRatesGuardChain;
});
