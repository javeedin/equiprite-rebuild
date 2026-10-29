define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Re-runs the page-entry RBAC decision ONCE, after the access map lands.
  //
  // WHY: every page guard (enforcePageAccessChain) runs on vbBeforeEnter, and
  // canEnterPage ADMITS while pageAccessLoaded is false so a cold load does not
  // bounce everyone. The first page of a session is therefore never really
  // checked: open the app straight onto /equipment-workbench and the guard has
  // already let you in by the time the role lookup finishes. For a user with
  // no role at all that meant a working page.
  //
  // The shell is the one page present for the whole session, so it waits here
  // and asks the same question again with the real map. Holds NO policy: the
  // page code, the decision and the redirect target all come from
  // $application.functions, exactly as in the page guards.
  //
  // Bounded: loadPageAccessChain settles the latch in every outcome, so this
  // normally returns as soon as the lookup ends. If it never settles (a hung
  // call) nothing is done, matching the guards' admit-while-loading rule.
  const TRIES = 300;
  const GAP_MS = 50;

  async function waitForPageAccess($application) {
    for (let i = 0; i < TRIES; i++) {
      if ($application.variables.pageAccessLoaded) return true;
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
    return false;
  }

  class recheckPageAccessChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      try {
        if (!await waitForPageAccess($application)) {
          console.warn('[recheckPageAccessChain] page access never settled;'
            + ' leaving the page as the guard admitted it');
          return;
        }

        const fns = $application.functions;
        const vars = $application.variables;
        const current = $application.currentPage || {};
        const pageCode = fns.getPageCodeForPage(current);

        // Ungated page (detail pages, No Access itself) - nothing to re-check.
        if (!pageCode) { return; }

        if (fns.canEnterPage(vars.pageAccessMap, vars.pageAccessLoaded, pageCode)) {
          return;
        }

        const home = fns.getRoleHomeTarget(vars.featureFlags, vars.flagsLoaded,
          vars.pageAccessMap, vars.pageAccessLoaded);
        if (home.page === current.id) { return; }

        console.warn('[recheckPageAccessChain] cold-load page', pageCode,
          'is not allowed for this role ->', home.flow + '/' + home.page);

        // Same call shape as goToDashboardChain, the other shell-level
        // redirect: no target:'parent', because the shell's own router is the
        // one that switches flows.
        await Actions.navigateToFlow(context, {
          flow: home.flow,
          page: home.page,
        });
      } catch (e) {
        console.error('[recheckPageAccessChain] unexpected error', e);
      }
    }
  }

  return recheckPageAccessChain;
});
