define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // Menu click. The route comes from the menu definition (getNavRoute in app-flow.js), so there is no second
  // table of flow/page names here to drift: a screen built in New EquipRite opens its page, any other menu item
  // opens the later page, which offers the same screen in Old EquipRite.
  class navigateChain extends ActionChain {
    /**
     * @param {Object} context
     * @param {Object} params
     * @param {string} params.navId menu item id (NAV_GROUPS in app-flow.js)
     */
    async run(context, { navId }) {
      const { $page, $application } = context;
      if (!navId) {
        return;
      }
      const fns = $application.functions;
      const vars = $application.variables;
      if (!fns.navIdVisible(vars.pageAccessMap, vars.pageAccessLoaded, navId)) {
        console.warn('[navigateChain] blocked by RBAC:', navId);
        return;
      }
      const route = fns.getNavRoute(navId);
      if (!route) {
        return;
      }
      $page.variables.isDrawerOpen = false;
      await Actions.navigateToFlow(context, {
        flow: route.flow,
        page: route.page,
        params: route.params || {},
      });
    }
  }

  return navigateChain;
});
