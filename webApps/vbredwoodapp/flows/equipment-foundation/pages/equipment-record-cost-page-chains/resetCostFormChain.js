define([
  'vb/action/actionChain',
  'resources/js/recordCostMock',
], (ActionChain, rc) => {
  'use strict';

  const FORM_VAR = {
    rawCost:       'rawCostForm',
    materialIssue: 'materialIssueForm',
    expenseReport: 'expenseReportForm',
    apInvoice:     'apInvoiceForm'
  };

  // Back to the unit's defaults for the visible tab. Charge To is shared by
  // all four tabs, so it is reset too - Reset means "start this cost over".
  class resetCostFormChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const tab = $page.variables.selectedTab;
      const ctx = $page.variables.ctx || {};
      if (FORM_VAR[tab]) {
        $page.variables[FORM_VAR[tab]] = rc.defaults(tab, ctx);
      }
      $page.variables.projectForm = rc.projectDefaults(ctx);
      $page.variables.formError = '';
    }
  }

  return resetCostFormChain;
});
