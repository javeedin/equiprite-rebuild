define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Opens or closes a month in the Utilization table (the old grid's inline toggle, toggleUtilMonth).
  class toggleMonthChain extends ActionChain {
    async run(context, { month }) {
      const { $page } = context;
      if (!month) return;
      $page.variables.collapsedMonths = $page.functions.toggleUtilMonth($page.variables.collapsedMonths, month);
    }
  }

  return toggleMonthChain;
});
