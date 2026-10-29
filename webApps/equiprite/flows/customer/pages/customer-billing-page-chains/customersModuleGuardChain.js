define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Page guard for the CUSTOMERS_MODULE_ENABLED module licence, from Old EquipRite's
  // customer-portal/pages/*-page-chains/customersModuleGuardChain.js. Every customer page runs it first on vbEnter:
  // with the Customers module off it says so and sends the user home, so a bookmark or deep link cannot open a portal
  // page the menu hides. Same copy in every customer page's chains folder.
  //
  // One change: it waits briefly for the flags to load before deciding. The old copy decided at once and, flags still
  // loading on a cold start, sent a licensed user home; it still fails closed if they never arrive.
  //
  // UX layer only: the backend must refuse customer calls on its own.
  const TRIES = 60;
  const GAP_MS = 50;

  class customersModuleGuardChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      for (let i = 0; i < TRIES && !$application.variables.flagsLoaded; i++) {
        await new Promise((r) => setTimeout(r, GAP_MS));
      }

      const enabled = $application.functions.isFeatureEnabled(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded,
        'CUSTOMERS_MODULE_ENABLED'
      );
      if (enabled) {
        return true;
      }

      await Actions.fireNotificationEvent(context, {
        summary: 'Module unavailable',
        message: 'Equipment for Customers is not enabled.',
        displayMode: 'transient',
        type: 'warning'
      });

      const home = $application.functions.getHomeTarget(
        $application.variables.featureFlags,
        $application.variables.flagsLoaded
      );

      // Home is in another flow, so target 'parent'.
      await Actions.navigateToFlow(context, {
        flow: home.flow,
        page: home.page,
        target: 'parent'
      });
      return false;
    }
  }

  return customersModuleGuardChain;
});
