define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Generic nav-id router for the Dashboard's data-driven targets.
   *
   * Every KPI tile and the table's View All button declares a nav-list id in
   * dashboardRoleConfig rather than a flow/page pair, so this one chain
   * replaces the per-destination goto*Chain files the page used to need (one
   * per tile, per persona — six personas' worth).
   *
   * The route table itself stays in app-flow.js (NAV_ID_TO_ROUTE), reached via
   * $application.functions.getNavRoute, so this chain holds no routing policy.
   */
  class gotoNavTargetChain extends ActionChain {
    /**
     * @param {Object} context
     * @param {Object} params
     * @param {string} params.navId - nav-list <li id> to route to
     */
    async run(context, { navId }) {
      const { $application } = context;

      const route = $application.functions.getNavRoute(navId);
      if (!route) {
        // Unknown or absent id (a deliberately non-clickable tile declares
        // nav:null). Do nothing rather than navigate somewhere arbitrary.
        return;
      }

      // Which navigation action to use depends on whether the destination is
      // in the flow already displayed. navigateToFlow + target:'parent' asks
      // the PARENT router to switch flows; when the target flow is already the
      // displayed one there is nothing to switch and VB throws "Cannot read
      // properties of null (reading 'getLeafPageInstanceFromFlowId')".
      // Omitting 'parent' has the mirror problem on a genuine cross-flow hop:
      // VB resolves the flow id relative to the current flow and 404s.
      //
      // This page lives in 'main', and several targets (equipment-requests,
      // equipment-schedule, rate-schedule) are in 'main' too, so BOTH branches
      // are live here — this is not a theoretical guard.
      if ($application.functions.isSameFlow($application.currentPage, route.flow)) {
        await Actions.navigateToPage(context, { page: route.page });
      } else {
        await Actions.navigateToFlow(context, {
          flow: route.flow,
          page: route.page,
          target: 'parent'
        });
      }
    }
  }

  return gotoNavTargetChain;
});
