define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  class StayInCatalogChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const dialog = document.getElementById('unsavedSelectionsDialog');
      if (dialog && typeof dialog.close === 'function') dialog.close();

      $page.variables.unsavedSelectionsCount = 0;
    }
  }

  return StayInCatalogChain;
});
