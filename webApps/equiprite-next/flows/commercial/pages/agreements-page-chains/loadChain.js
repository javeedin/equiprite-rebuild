define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/rules',
  'resources/js/agreementRules',
], (ActionChain, Actions, rules, A) => {
  'use strict';

  // The agreements: New EquipRite's agreementsFlagGuardChain rule first (Equipment for Projects and AGREEMENTS_ENABLED
  // must both be on; it waits up to three seconds for the settings; fails closed) and, in Next, said on the page
  // rather than sending people away. Then New's agreementsInitChain (the old RentalAgreementInitChain): FULL access
  // shows New agreement; GET views/rental-agreements page 0, size 200; rows agreementRules.listRow, newest first.
  // A failed read is said, not shown as an empty list.
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
      v.unavailable = '';
      v.canWrite = rules.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RENTAL_AGREEMENTS') === 'FULL';
      v.isLoading = true;
      try {
        const response = await Actions.callRest(context, {
          endpoint: 'eqp-v1/getEquipriteV1ViewsRentalAgreements',
          uriParams: { page: 0, size: 200 }
        });
        if (!response || !response.ok) {
          v.error = 'The agreements could not be loaded (HTTP ' + (response && response.status) + ').';
        } else {
          v.error = '';
        }
        const rows = (response && response.body && response.body.data) || [];
        v.rows = A.newestFirst(rows.map(A.listRow));
      } catch (e) {
        console.error('[agreements loadChain] failed', e);
        v.error = 'The agreements could not be loaded.';
      } finally {
        v.isLoading = false;
      }
      await Actions.callChain(context, { chain: 'applyChain' });
    }
  }

  return loadChain;
});
