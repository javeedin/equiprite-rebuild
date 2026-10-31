define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rules',
], (ActionChain, Actions, rules) => {
  'use strict';

  // Opens the tab. New EquipRite's agreementsFlagGuardChain rule first (Equipment for Projects and AGREEMENTS_ENABLED
  // both on; waits up to three seconds for the settings; fails closed), said on the page. FULL access to
  // EQR_RENTAL_AGREEMENTS shows Approve, Reject and Edit (New's linesAccessChain). Then a new agreement opens its form
  // (editLoadChain), any other the agreement and its lines (viewLoadChain). Nothing is written on entry.
  const TRIES = 60;
  const GAP_MS = 50;

  class loadChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const v = $page.variables;
      const av = $application.variables;
      for (let i = 0; i < TRIES && !(av.flagsLoaded && av.pageAccessLoaded); i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      const projects = rules.isFeatureEnabled(av.featureFlags, av.flagsLoaded, 'PROJECTS_MODULE_ENABLED');
      const agreements = rules.isFeatureEnabled(av.featureFlags, av.flagsLoaded, 'AGREEMENTS_ENABLED');
      if (!(projects && agreements)) {
        v.isLoading = false;
        v.unavailable = projects ? 'Rental agreements are turned off in Settings (AGREEMENTS_ENABLED).'
          : 'Rental agreements need Equipment for Projects, which is not enabled.';
        return;
      }
      v.canWrite = rules.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RENTAL_AGREEMENTS') === 'FULL';
      if (v.id === 'new') {
        v.isLoading = false;
        await Actions.callChain(context, { chain: 'editLoadChain', params: { headerId: null } });
        return;
      }
      await Actions.callChain(context, { chain: 'viewLoadChain' });
    }
  }

  return loadChain;
});
