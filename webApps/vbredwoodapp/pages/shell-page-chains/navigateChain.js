define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class navigateChain extends ActionChain {

    /**
     * @param {Object} context
     * @param {Object} params
     * @param {string} params.pageId 
     */
    async run(context, { pageId }) {
      const { $page, $application } = context;

      if (!pageId) {
        return;
      }

      // RBAC gate. The drawer already omits items the role may not open, so
      // this normally never trips from a menu click — it catches programmatic
      // callers (tile clicks, chain redirects) that pass a nav id directly.
      // Deep links by URL are caught separately by the page-entry guard.
      // Fails closed: an unknown nav id or an unloaded map blocks navigation.
      if (!$application.functions.navIdVisible(
        $application.variables.pageAccessMap,
        $application.variables.pageAccessLoaded,
        pageId)) {
        console.warn('[navigateChain] blocked by RBAC:', pageId);
        $page.variables.isDrawerOpen = false;
        return;
      }

      // Use official VBCS cross-flow navigation
      let targetFlow = 'main';
      let targetPage = pageId;

      if (pageId === 'main-dashboard') {
        // Module-dependent home — see getHomeTarget(). With the Projects module
        // off this routes to the customer dashboard rather than the (unlicensed)
        // project one.
        const home = $application.functions.getHomeTarget(
          $application.variables.featureFlags,
          $application.variables.flagsLoaded
        );
        targetFlow = home.flow;
        targetPage = home.page;
      } else if (pageId === 'setup-configurations') {
        targetFlow = 'setup';
        targetPage = 'configurations';
      } else if (pageId === 'setup-rbac-admin') {
        targetFlow = 'setup';
        targetPage = 'rbac-admin';
      } else if (pageId === 'project-create-request') {
        targetFlow = 'customer-portal';
        targetPage = 'project-create-request';
      } else if (pageId === 'equipment-requests') {
        targetFlow = 'main';
        targetPage = 'equipment-requests';
      } else if (pageId === 'equipment-schedule') {
        targetFlow = 'main';
        targetPage = 'equipment-schedule';
      } else if (pageId === 'main-equipment-master') {
        targetFlow = 'equipment-foundation';
        targetPage = 'equipment-master';
      } else if (pageId === 'main-equipment-workbench') {
        targetFlow = 'equipment-foundation';
        targetPage = 'equipment-workbench';
      } else if (pageId === 'initiate-picking') {
        targetFlow = 'equipment-foundation';
        targetPage = 'initiate-picking';
      } else if (pageId === 'equipment-returns') {
        targetFlow = 'equipment-foundation';
        targetPage = 'equipment-returns';
      } else if (pageId === 'rate-schedule') {
        targetFlow = 'main';
        targetPage = 'rate-schedule';
      } else if (pageId === 'main-equipment-timesheets') {
        targetFlow = 'equipment-foundation';
        targetPage = 'equipment-timesheets';
      } else if (pageId === 'main-timesheet-approvals') {
        targetFlow = 'equipment-foundation';
        targetPage = 'timesheet-approvals';
      } else if (pageId === 'post-cost') {
        targetFlow = 'equipment-foundation';
        targetPage = 'post-cost';
      } else if (pageId === 'post-cost-test') {
        targetFlow = 'equipment-foundation';
        targetPage = 'post-cost-test';
      } else if (pageId === 'main-rental-agreements') {
        targetFlow = 'equipment-foundation';
        targetPage = 'rental-agreements';
      } else if (pageId === 'create-rental-agreement') {
        targetFlow = 'equipment-foundation';
        targetPage = 'rental-agreement-create';
      } else if (pageId === 'rental-agreement-approval') {
        targetFlow = 'equipment-foundation';
        targetPage = 'rental-agreements';
      } else if (pageId === 'main-equipment-analytics') {
        targetFlow = 'equipment-foundation';
        targetPage = 'equipment-analytics';
      } else if (pageId === 'main-equipment-reports') {
        targetFlow = 'equipment-foundation';
        targetPage = 'equipment-reports';
      } else if (pageId === 'customer-dashboard') {
        targetFlow = 'customer-portal';
        targetPage = 'customer-dashboard';
      } else if (pageId === 'request-catalog') {
        targetFlow = 'customer-portal';
        targetPage = 'request-catalog';
      } else if (pageId === 'customer-create-req') {
        targetFlow = 'customer-portal';
        targetPage = 'customer-create-req';
      } else if (pageId === 'customer-my-requests') {
        targetFlow = 'customer-portal';
        targetPage = 'customer-my-requests';
      } else if (pageId === 'customer-my-billing') {
        targetFlow = 'customer-portal';
        targetPage = 'customer-my-billing';
      }

      const flowToNavigate = String(targetFlow || 'main');
      const pageToNavigate = String(targetPage || 'equipment-requests');

      console.log('[navigateChain] Navigating to:', { flow: flowToNavigate, page: pageToNavigate });

      await Actions.navigateToFlow(context, {
        flow: flowToNavigate,
        page: pageToNavigate,
      });

      // 2. Close the drawer after navigation
      $page.variables.isDrawerOpen = false;
    }
  }

  return navigateChain;
});
