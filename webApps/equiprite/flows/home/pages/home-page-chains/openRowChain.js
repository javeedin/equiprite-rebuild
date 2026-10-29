define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A row on Home. Requests open New EquipRite's Request detail; timesheet weeks, post cost and picking rows open
  // their New EquipRite screen (newRowTarget in home-page.js) when its menu item is built and visible to the role,
  // else the same screen in Old EquipRite (oldRequestLink).
  const REQUEST_SHAPES = ['myRequests', 'workbench'];

  class openRowChain extends ActionChain {
    async run(context, { row }) {
      const { $page, $application, $functions } = context;
      if (!row) {
        return;
      }
      const shape = $page.variables.tableRowNav;
      if (REQUEST_SHAPES.indexOf(shape) !== -1 && row.eqrEquipmentRequestId != null) {
        await Actions.navigateToFlow(context, {
          flow: 'request',
          page: 'request-detail',
          target: 'parent',
          params: { requestId: String(row.requestNumber || ''), requestNumericId: Number(row.eqrEquipmentRequestId) },
        });
        return;
      }
      const target = $functions.newRowTarget(row, shape);
      const route = target ? $application.functions.getNavRoute(target.navId) : null;
      const vars = $application.variables;
      if (route && route.page !== 'later'
          && $application.functions.navIdVisible(vars.pageAccessMap, vars.pageAccessLoaded, target.navId)) {
        await Actions.navigateToFlow(context, {
          flow: route.flow, page: route.page, target: 'parent', params: Object.assign({}, route.params, target.params),
        });
        return;
      }
      const link = $functions.oldRequestLink($application.variables.oldAppUrl, row, shape);
      if (link) {
        window.location.assign(link);
      }
    }
  }

  return openRowChain;
});
