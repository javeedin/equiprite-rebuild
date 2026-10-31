define([
  'vb/action/actionChain',
  'resources/js/unitScanner',
], (ActionChain, scanner) => {
  'use strict';

  // The camera's light on or off, where the device has one (New's ToggleTorchChain).
  class torchChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const stream = window.__nxYardScanStream;
      if (!stream) return;
      const want = !v.scan.torchOn;
      const now = await scanner.setTorch(stream, want);
      v.scan = Object.assign({}, v.scan, want && !now
        ? { torchOn: false, torch: false, status: 'This device would not turn the light on.' }
        : { torchOn: now });
    }
  }

  return torchChain;
});
