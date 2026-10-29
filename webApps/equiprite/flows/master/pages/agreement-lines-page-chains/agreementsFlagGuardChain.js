define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Feature guard for the agreement pages (vbBeforeEnter, before enforcePageAccessChain), from the old
  // rental-agreements-page-chains/agreementsFlagGuardChain.js: Equipment for Projects (PROJECTS_MODULE_ENABLED)
  // and AGREEMENTS_ENABLED must both be on, or a deep link is sent away with a notice. Fails closed.
  //
  // Changes: it waits up to three seconds for the settings to load before judging (the old guard failed closed
  // at once, which bounces a deep link that arrives while settings are still loading), and it sends people to
  // their own landing page (getRoleHomeTarget), as enforcePageAccessChain does, instead of the old dashboard.
  // IDENTICAL copies live in the agreements, agreement-lines and agreement-edit chains folders.
  const TRIES = 60;
  const GAP_MS = 50;

  class agreementsFlagGuardChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      const vars = $application.variables;
      const fns = $application.functions;
      for (let i = 0; i < TRIES && !vars.flagsLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }
      const projects = fns.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, 'PROJECTS_MODULE_ENABLED');
      const agreements = fns.isFeatureEnabled(vars.featureFlags, vars.flagsLoaded, 'AGREEMENTS_ENABLED');
      if (projects && agreements) {
        return;
      }
      await Actions.fireNotificationEvent(context, projects
        ? { summary: 'Feature unavailable', message: 'Rental Agreements is disabled by configuration.', displayMode: 'transient', type: 'warning' }
        : { summary: 'Module unavailable', message: 'Equipment for Projects is not enabled.', displayMode: 'transient', type: 'warning' });
      const home = fns.getRoleHomeTarget(vars.featureFlags, vars.flagsLoaded, vars.pageAccessMap, vars.pageAccessLoaded);
      // Same flow -> navigateToPage, else navigateToFlow with target 'parent' (see isSameFlow in app-flow.js).
      if (fns.isSameFlow($application.currentPage, home.flow)) {
        await Actions.navigateToPage(context, { page: home.page, params: home.params || {} });
      } else {
        await Actions.navigateToFlow(context, { flow: home.flow, page: home.page, params: home.params || {}, target: 'parent' });
      }
    }
  }

  return agreementsFlagGuardChain;
});
