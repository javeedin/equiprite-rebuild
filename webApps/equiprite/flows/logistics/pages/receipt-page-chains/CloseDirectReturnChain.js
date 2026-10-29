define([
  'vb/action/actionChain',
  'vb/action/actions',
], (ActionChain, Actions) => {
  'use strict';

  /**
   * Close the Direct Return dialog.
   *
   * Imperative, matching how it is opened: oj-dialog exposes open()/close()
   * methods, not a bindable `opened` property.
   *
   * Releases the camera on the way out. Closing the dialog while the
   * viewfinder is up would otherwise leave the stream live: the camera light
   * stays on and the device is held against other apps, which on a phone
   * reads as the app watching you. CloseScannerChain is safe to call when
   * nothing is scanning.
   */
  class CloseDirectReturnChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      await Actions.callChain(context, { chain: 'CloseScannerChain' });

      $page.variables.directReturnOpen = false;
      const dialog = document.getElementById('directReturnDialog');
      if (dialog && typeof dialog.close === 'function') dialog.close();
    }
  }

  return CloseDirectReturnChain;
});
