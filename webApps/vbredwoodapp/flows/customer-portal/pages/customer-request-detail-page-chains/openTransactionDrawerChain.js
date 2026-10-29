define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class openTransactionDrawerChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      $page.variables.transactionData = {
        expenditure_type: 'Equipment Usage',
        organization: 'Texas Operations',
        raw_cost_amount: 0,
        post_immediate_raw_cost: false,
        narrative_comments: null,
        oracle_item_number: null,
        quantity_issued: 0,
        unit_of_measure: 'EA'
      };

      $page.variables.activeTransactionTab = '16a';
      $page.variables.isTransactionDrawerOpen = true;
    }
  }

  return openTransactionDrawerChain;
});
