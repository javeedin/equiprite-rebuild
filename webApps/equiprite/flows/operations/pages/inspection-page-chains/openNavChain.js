define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Opens a menu item from a page (KPI tiles, View all, quick actions). The route comes from the menu definition
  // (getNavRoute), so a page never names flows itself. Same flow -> navigateToPage, else navigateToFlow with
  // target 'parent' (see isSameFlow in app-flow.js for why the choice matters).
  class openNavChain extends ActionChain {
    /**
     * @param {Object} context
     * @param {Object} params
     * @param {string} params.navId menu item id
     */
    async run(context, { navId }) {
      const { $application } = context;
      const fns = $application.functions;
      const vars = $application.variables;
      if (!navId || !fns.navIdVisible(vars.pageAccessMap, vars.pageAccessLoaded, navId)) {
        return;
      }
      const route = fns.getNavRoute(navId);
      if (!route) {
        return;
      }
      if (fns.isSameFlow($application.currentPage, route.flow)) {
        await Actions.navigateToPage(context, { page: route.page, params: route.params || {} });
      } else {
        await Actions.navigateToFlow(context, {
          flow: route.flow, page: route.page, params: route.params || {}, target: 'parent',
        });
      }
    }
  }

  return openNavChain;
});
