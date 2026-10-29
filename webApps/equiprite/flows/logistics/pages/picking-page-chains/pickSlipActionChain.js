define([
  'vb/action/actionChain',
], (ActionChain) => {
  'use strict';

  // Print or Download in the pick slip preview. The old page bound the page module's printPickSlip /
  // downloadPickSlip straight to its buttons; this is the same call through a listener. DOM only, no REST.
  class pickSlipActionChain extends ActionChain {
    async run(context, { action }) {
      const { $page } = context;
      if (action === 'print') {
        $page.functions.printPickSlip();
      } else if (action === 'download') {
        $page.functions.downloadPickSlip($page.variables.pickSlipUrl, $page.variables.pickSlipFileName);
      }
    }
  }

  return pickSlipActionChain;
});
