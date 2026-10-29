define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // A row on Home. Request detail is not rebuilt yet, so the row opens the same request in Old EquipRite
  // (oldRequestLink in home-page.js); rows without a request id (timesheet weeks) open their list instead.
  class openRowChain extends ActionChain {
    async run(context, { row }) {
      const { $page, $application, $functions } = context;
      if (!row) {
        return;
      }
      const link = $functions.oldRequestLink($application.variables.oldAppUrl, row, $page.variables.tableRowNav);
      if (link) {
        window.location.assign(link);
      }
    }
  }

  return openRowChain;
});
