define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // "Record Cost" header button -> equipment-record-cost-page (POC) for this
  // unit. Carries the same three ids this page was opened with, so that
  // page's Back returns here and its entry chain reads the right unit table.
  class goToRecordCostChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      await Actions.navigateToPage(context, {
        page: 'equipment-record-cost',
        params: {
          equipmentId: String($page.variables.equipmentId || ''),
          serialRefId: String($page.variables.serialRefId || ''),
          controlType: $page.variables.controlType || 'SERIAL'
        }
      });
    }
  }

  return goToRecordCostChain;
});
