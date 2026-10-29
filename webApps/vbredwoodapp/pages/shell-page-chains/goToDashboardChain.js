define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class goToDashboardChain extends ActionChain {

    /**
     * @param {Object} context
     */
    async run(context) {
      const { $page, $application } = context;

      // Home is module- AND role-dependent. getRoleHomeTarget() owns that rule
      // — do not re-derive it here. It wraps getHomeTarget with an RBAC layer,
      // because the flag-based home is the Dashboard and most roles have no
      // access to it: sending them there means the page's own guard bounces
      // them straight back, which is a redirect loop rather than a landing.
      const home = $application.functions.getRoleHomeTarget(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded,
        $application.variables.pageAccessMap,
        $application.variables.pageAccessLoaded
      );

      // NO target:'parent' here — this chain runs on the shell, whose own
      // routerFlow IS 'main'. 'parent' asks the PARENT router to switch flows;
      // from the shell there is no parent to switch when the destination is
      // the flow already being displayed, and VB throws
      // "Cannot read properties of null (reading 'getLeafPageInstanceFromFlowId')".
      //
      // It went unnoticed while getRoleHomeTarget always returned a DIFFERENT
      // flow (setup, equipment-foundation, customer-portal). Now that the
      // Dashboard is the shared landing page, home.flow is 'main' for most
      // roles and the same-flow case is the common one.
      //
      // navigateChain — the menu router on this same page — omits target for
      // every destination including its own 'main' pages, and works. Match it.
      await Actions.navigateToFlow(context, {
        flow: home.flow,
        page: home.page,
      });

      $page.variables.isDrawerOpen = false;
    }
  }

  return goToDashboardChain;
});
