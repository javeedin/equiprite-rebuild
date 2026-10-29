define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class onTaskSelectedChain extends ActionChain {
    async run(context, { detail } = {}) {
      const { $page } = context;

      const taskName = detail && detail.itemContext && detail.itemContext.data
        ? detail.itemContext.data.TaskName
        : null;
      $page.variables.formData.taskName = taskName;
    }
  }

  return onTaskSelectedChain;
});
