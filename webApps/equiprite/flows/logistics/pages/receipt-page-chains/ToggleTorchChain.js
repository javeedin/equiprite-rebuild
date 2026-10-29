define([
  'vb/action/actionChain',
  'resources/js/unitScanner',
], (ActionChain, scanner) => {
  'use strict';

  /**
   * Turn the camera torch on or off.
   *
   * Yard returns happen in a shed, in a container, or at dusk as often as in
   * daylight, and an unlit stamped tag is the commonest reason a barcode will
   * not resolve at all. On a phone or tablet the lamp is the difference
   * between scanning and typing the serial by hand.
   *
   * Only reachable when scanTorchAvailable is true, which is read from the
   * live track's capabilities — laptops have no torch and never show the
   * control. setTorch resolves false rather than throwing if the device
   * refuses, so a race against teardown cannot break the dialog.
   */
  class ToggleTorchChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const stream = window.__eqrScanStream;
      if (!stream) return;

      const want = !$page.variables.scanTorchOn;
      const now = await scanner.setTorch(stream, want);
      $page.variables.scanTorchOn = now;

      // Asked for it and did not get it: say so rather than leaving a button
      // that visibly does nothing.
      if (want && !now) {
        $page.variables.scanTorchAvailable = false;
        $page.variables.scanStatus = 'This device would not turn the light on.';
      }
    }
  }

  return ToggleTorchChain;
});
