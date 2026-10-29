define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class onProjectSelectedChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      $page.variables.formData.taskId = null;
    }
  }

  return onProjectSelectedChain;
});
