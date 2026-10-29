define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // A row on Home. Requests open New EquipRite's Request detail. Rows whose screens are not rebuilt yet
  // (timesheet weeks, post cost, picking) open them in Old EquipRite (oldRequestLink in home-page.js).
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
      const link = $functions.oldRequestLink($application.variables.oldAppUrl, row, shape);
      if (link) {
        window.location.assign(link);
      }
    }
  }

  return openRowChain;
});
