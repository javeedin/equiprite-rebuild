define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class CancelSaveTemplateChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      const dialog = document.getElementById('saveTemplateDialog');
      if (dialog && typeof dialog.close === 'function') dialog.close();

      $page.variables.templateName        = '';
      $page.variables.templateDescription = '';
      $page.variables.templateNameError   = '';
    }
  }

  return CancelSaveTemplateChain;
});
