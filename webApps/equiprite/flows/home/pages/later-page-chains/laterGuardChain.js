define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Page access for the later page: it stands for a menu item, so it is open exactly when that item is (any of its
  // page codes). A bookmark to an item this role cannot see, or an unknown item, goes to the role's home. Runs on
  // vbEnter (page variables, including the navId from the URL, do not exist yet in vbBeforeEnter) and waits for
  // page access to settle, since the shell's recheckPageAccessChain does not cover this page.
  const TRIES = 300;
  const GAP_MS = 50;

  class laterGuardChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const fns = $application.functions;
      const vars = $application.variables;
      for (let i = 0; i < TRIES && !vars.pageAccessLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      if (!vars.pageAccessLoaded) {
        return;
      }
      if (fns.navItem($page.variables.navId) && fns.navIdVisible(vars.pageAccessMap, vars.pageAccessLoaded, $page.variables.navId)) {
        return;
      }
      const home = fns.getRoleHomeTarget(vars.featureFlags, vars.flagsLoaded, vars.pageAccessMap, vars.pageAccessLoaded);
      if (home.page === 'later' && home.params && home.params.navId === $page.variables.navId) {
        return;
      }
      console.warn('[laterGuardChain] not allowed:', $page.variables.navId, '->', home.flow + '/' + home.page);
      await Actions.navigateToPage(context, { page: home.page, params: home.params || {} });
    }
  }

  return laterGuardChain;
});
