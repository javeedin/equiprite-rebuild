define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // FULL access to EQR_RENTAL_AGREEMENTS shows Approve, Reject and Edit (the old lines page showed them to anyone
  // who could open it). Requesting from the lines needs no more than opening the page, as before.
  class linesAccessChain extends ActionChain {
    async run(context) {
      const { $page, $application } = context;
      const av = $application.variables;
      for (let i = 0; i < 60 && !av.pageAccessLoaded; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      $page.variables.canWrite = $application.functions.pageAccess(av.pageAccessMap, av.pageAccessLoaded,
        'EQR_RENTAL_AGREEMENTS') === 'FULL';
    }
  }

  return linesAccessChain;
});
