define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class ScheduleFilterChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.functions.filterScheduler($page.variables.filterCriterion);
    }
  }

  return ScheduleFilterChain;
});
