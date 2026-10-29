define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class onTermsCancelChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      $page.variables.termsAccepted     = false;
      $page.variables.isTermsDialogOpen = false;

      const dlg = document.getElementById('termsDialog');
      if (dlg && typeof dlg.close === 'function') dlg.close();
    }
  }

  return onTermsCancelChain;
});
