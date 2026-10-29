define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens Rate schedules. As the old rate-schedule page's vbEnter: rateManagementGuardChain (copied unchanged:
  // withdrawn when every business unit takes Fusion PPM rates), then the list (loadSchedulesChain). The guard is
  // run once the settings have loaded: isRateManagementHidden reads "not loaded yet" as hidden, and checking
  // before that would send people away from a page they may use.
  //
  // Then the schedule named in the address (?scheduleId=), else the first active one, opens on the right.
  const TRIES = 60;
  const GAP_MS = 50;

  class ratesInitChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const av = $application.variables;
      for (let i = 0; i < TRIES && !(av.flagsLoaded && av.pageAccessLoaded); i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      const fns = $application.functions;
      if (fns.isRateManagementHidden(av.featureFlags, av.flagsLoaded, av.buRateSources)) {
        await Actions.callChain(context, { chain: 'rateManagementGuardChain' });
        return;
      }
      $page.variables.canWrite = fns.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RATE_SCHEDULE') === 'FULL';
      $page.variables.isLoading = true;
      await Actions.callChain(context, { chain: 'loadSchedulesChain' });
      $page.variables.isLoading = false;

      const rows = $page.variables.schedules || [];
      const wanted = Number($page.variables.scheduleId) || null;
      const pick = (wanted && rows.find((r) => Number(r.id) === wanted))
        || rows.find((r) => r.status === 'ACTIVE') || rows[0];
      if (pick) {
        await Actions.callChain(context, { chain: 'selectScheduleChain', params: { id: pick.id, confirmed: true } });
      }
    }
  }

  return ratesInitChain;
});
