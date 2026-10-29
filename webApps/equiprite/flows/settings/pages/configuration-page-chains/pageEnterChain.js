define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // New EquipRite: a role with READ_ONLY access to EQR_CONFIGURATIONS sees every setting but no control that
  // changes one (app-flow.js isPageReadOnly, the page-wide switch every New page uses). The old page did not read
  // the access level.
  class pageEnterChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const vars = $application.variables;
      $page.variables.readOnly = !!$application.functions.isPageReadOnly(
        vars.pageAccessMap, vars.pageAccessLoaded, 'EQR_CONFIGURATIONS');
    }
  }

  return pageEnterChain;
});
