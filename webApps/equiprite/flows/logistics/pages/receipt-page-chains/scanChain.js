define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  // "Scan barcode or serial plate" in the band: opens the Direct Return dialog (OpenDirectReturnChain, copied
  // unchanged) and, when this device can open a camera, starts it straight away (OpenScannerChain, copied
  // unchanged). Without a camera the dialog says why, and a barcode gun still types into its search box.
  class scanChain extends ActionChain {
    async run(context) {
      const { $page } = context;
      await Actions.callChain(context, { chain: 'OpenDirectReturnChain' });
      if ($page.variables.scanSupported) {
        await Actions.callChain(context, { chain: 'OpenScannerChain' });
      }
    }
  }

  return scanChain;
});
