define([
  'vb/action/actionChain',
  'resources/js/unitScanner',
], (ActionChain, scanner) => {
  'use strict';

  // The camera's light on or off, where the phone has one (Next's torchChain): a tag in a shed or at dusk.
  class torchChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const stream = window.__mbPickScanStream;
      if (!stream) return;
      const want = !v.scan.torchOn;
      const now = await scanner.setTorch(stream, want);
      v.scan = Object.assign({}, v.scan, want && !now
        ? { torchOn: false, torch: false, status: 'This phone would not turn the light on.' }
        : { torchOn: now });
    }
  }

  return torchChain;
});
