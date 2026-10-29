define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // New agreement (the old navigateToCreateChain). FULL access to EQR_RENTAL_AGREEMENTS: the button is hidden
  // below FULL and the edit page checks again (the old create page had no access check at all).
  class newAgreementChain extends ActionChain {
    async run(context) {
      const { $application } = context;
      const av = $application.variables;
      if ($application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded, 'EQR_RENTAL_AGREEMENTS') !== 'FULL') return;
      await Actions.navigateToPage(context, { page: 'agreement-edit' });
    }
  }

  return newAgreementChain;
});
