define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';
  class collapseScheduleParamsChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      $page.variables.scheduleParamsExpanded = false;
    }
  }
  return collapseScheduleParamsChain;
});
