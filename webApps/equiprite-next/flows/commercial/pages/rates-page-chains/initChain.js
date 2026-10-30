define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rules',
], (ActionChain, Actions, rules) => {
  'use strict';

  // Opens Rates, as New EquipRite's ratesInitChain: once the settings and page access have loaded (waiting up to three
  // seconds), New's rateManagementGuardChain rule (isRateManagementHidden: withdrawn when every business unit takes
  // Fusion PPM rates, the same rule that hides the menu item) and, unless withdrawn, the list (loadSchedulesChain).
  // Next does not send people away: a withdrawn screen says so in words. Then the first active schedule opens.
  // Nothing is written on entry.
  const TRIES = 60;
  const GAP_MS = 50;

  class initChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const av = $application.variables;
      for (let i = 0; i < TRIES && !(av.flagsLoaded && av.pageAccessLoaded); i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      if (rules.isRateManagementHidden(av.featureFlags, av.flagsLoaded, av.buRateSources)) {
        $page.variables.isLoading = false;
        $page.variables.hidden = 'Rates are not used: every business unit takes its rates from Fusion PPM, so EquipRite rate schedules '
          + 'are not read. Change Fusion PPM Rates, or a business unit\'s Rate Source, in Settings to use them.';
        return;
      }
      $page.variables.hidden = '';
      $page.variables.canWrite = rules.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RATE_SCHEDULE') === 'FULL';
      $page.variables.isLoading = true;
      try {
        await Actions.callChain(context, { chain: 'loadSchedulesChain' });
      } finally {
        $page.variables.isLoading = false;
      }
      await Actions.callChain(context, { chain: 'applyChain' });

      const rows = $page.variables.schedules || [];
      const pick = rows.find((r) => r.status === 'ACTIVE') || rows[0];
      if (pick) {
        await Actions.callChain(context, { chain: 'selectScheduleChain', params: { id: pick.id, confirmed: true } });
      }
    }
  }

  return initChain;
});
