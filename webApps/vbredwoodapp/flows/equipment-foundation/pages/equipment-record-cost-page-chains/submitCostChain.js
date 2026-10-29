define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/recordCostMock',
], (ActionChain, Actions, rc) => {
  'use strict';

  const FORM_VAR = {
    rawCost:       'rawCostForm',
    materialIssue: 'materialIssueForm',
    expenseReport: 'expenseReportForm',
    apInvoice:     'apInvoiceForm'
  };

  // MOCK record. Validates the visible tab plus Charge To, builds the request
  // the real build would send, and answers with a mock 201 - NO network call.
  // The real version should post through the eqpt backend / OIC, like every
  // other Fusion write in this app, and only add the row once Fusion accepts.
  class submitCostChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      if ($page.variables.isSubmitting) return;

      const tab = $page.variables.selectedTab;
      const form = $page.variables[FORM_VAR[tab]] || {};
      const project = $page.variables.projectForm || {};
      const ctx = $page.variables.ctx || {};

      // Project and task come from the unit and cannot be keyed in here.
      if (!ctx.projectNumber || !ctx.taskNumber) {
        $page.variables.formError = "This unit has no project and task yet. Set them on the unit's Overview tab with Edit Project & Task.";
        return;
      }

      const missing = rc.missingFields(tab, form, project);
      if (missing.length) {
        $page.variables.formError = 'Fill in: ' + missing.join(', ') + '.';
        return;
      }
      $page.variables.formError = '';
      $page.variables.isSubmitting = true;

      try {
        // A short pause so the POC behaves like a real round trip.
        await new Promise(resolve => setTimeout(resolve, 600));

        const seq = ($page.variables.recordedCosts || []).length + 1;
        const request = rc.buildRequest(tab, form, project, ctx);
        const response = rc.mockResponse(tab, request, seq);

        $page.variables.recordedCosts = [rc.toRecordedRow(tab, form, project, request, response, seq)]
          .concat($page.variables.recordedCosts || []);

        await Actions.fireNotificationEvent(context, {
          summary: rc.TABS.find(t => t.id === tab).title + ' recorded',
          message: response.body.MockId + (ctx.serialNumber ? ' · ' + ctx.serialNumber : ''),
          type: 'confirmation',
          displayMode: 'transient'
        });
      } finally {
        $page.variables.isSubmitting = false;
      }
    }
  }

  return submitCostChain;
});
