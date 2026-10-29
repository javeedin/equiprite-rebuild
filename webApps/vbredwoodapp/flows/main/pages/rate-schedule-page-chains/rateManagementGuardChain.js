define(['vb/action/actionChain', 'vb/action/actions'], (ActionChain, Actions) => {
  'use strict';

  // Withdraws Rate Management when no business unit prices from EquipRite.
  //
  // Rate Management maintains EquipRite rate schedules. Once Fusion PPM prices
  // every BU — the global PPM_RATES_ENABLED flag is on, or every configured BU
  // has RATE_SOURCE = PPM_RATES — nothing reads those schedules, so the screen
  // is withdrawn rather than left to collect rates nobody uses.
  //
  // The decision is isRateManagementHidden() in app-flow.js, the same call that
  // hides the menu entry, so the menu and this guard cannot disagree. Hiding a
  // menu entry removes the affordance, not the route; this blocks the route.
  //
  // IDENTICAL copies live in rate-schedule-page-chains and
  // create-rate-schedule-page-chains (a page resolves chain ids only in its own
  // folder). Change both.
  //
  // UX layer only.
  class rateManagementGuardChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      const fns = $application.functions;
      const vars = $application.variables;

      if (!fns.isRateManagementHidden(vars.featureFlags, vars.flagsLoaded, vars.buRateSources)) {
        return;
      }

      await Actions.fireNotificationEvent(context, {
        summary: 'Rate Management unavailable',
        message: 'Every business unit takes its rates from Fusion PPM, so EquipRite rate '
          + 'schedules are not used. Change Fusion PPM Rates or a business unit\'s Rate '
          + 'Source in Configurations to use them.',
        displayMode: 'transient',
        type: 'warning'
      });

      const home = fns.getRoleHomeTarget(vars.featureFlags, vars.flagsLoaded,
        vars.pageAccessMap, vars.pageAccessLoaded);

      // Same-flow vs cross-flow navigation, as in enforcePageAccessChain: the
      // landing page is usually in 'main', this page's own flow.
      if (fns.isSameFlow($application.currentPage, home.flow)) {
        await Actions.navigateToPage(context, { page: home.page });
      } else {
        await Actions.navigateToFlow(context,
          { flow: home.flow, page: home.page, target: 'parent' });
      }
    }
  }

  return rateManagementGuardChain;
});
