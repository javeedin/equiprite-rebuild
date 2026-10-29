define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Page-only view state: the exception-queue integration chip, and closing the Run / Apply confirmation.
  class setViewChain extends ActionChain {
    async run(context, { integ, cancelConfirm, dismissResult }) {
      const { $page } = context;
      if (integ !== undefined && integ !== null) {
        $page.variables.queueFilter = $page.variables.queueFilter === integ ? '' : String(integ);
      }
      if (cancelConfirm) {
        $page.variables.confirm = null;
      }
      if (dismissResult) {
        $page.variables.lastResult = null;
      }
    }
  }

  return setViewChain;
});
