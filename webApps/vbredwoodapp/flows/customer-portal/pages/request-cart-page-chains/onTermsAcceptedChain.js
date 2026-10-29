define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  class onTermsAcceptedChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      // Mark acceptance so SubmitRequestChain bypasses the dialog on re-entry.
      $page.variables.termsAccepted = true;

      const dlg = document.getElementById('termsDialog');
      if (dlg && typeof dlg.close === 'function') dlg.close();

      // Invoke the actual submission chain now that terms are accepted.
      await Actions.callChain(context, { id: 'SubmitRequestChain' });
    }
  }

  return onTermsAcceptedChain;
});
