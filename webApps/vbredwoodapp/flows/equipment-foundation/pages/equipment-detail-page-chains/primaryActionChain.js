define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class primaryActionChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      console.log('[Edit] Equipment:', $page.variables.recordData.equipment_id);
      // Edit workflow to be implemented in a future prompt
    }
  }

  return primaryActionChain;
});
