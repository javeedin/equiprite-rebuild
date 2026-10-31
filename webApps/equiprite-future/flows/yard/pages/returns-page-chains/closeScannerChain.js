define([
  'vb/action/actionChain',
  'resources/js/unitScanner',
], (ActionChain, scanner) => {
  'use strict';

  // Stops scanning and releases the camera (New's CloseScannerChain): the decode loop first, then the video, the torch
  // and the tracks. Safe to run twice and when no camera was opened.
  class closeScannerChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const handle = window.__nxYardScanHandle;
      window.__nxYardScanHandle = null;
      if (handle && typeof handle.stop === 'function') {
        try { handle.stop(); } catch (e) { console.warn('[closeScannerChain] stop failed:', e); }
      }
      const video = document.getElementById('ydrScanVideo');
      if (video) {
        try { video.pause(); } catch (e) { /* ignore */ }
        video.srcObject = null;
      }
      const stream = window.__nxYardScanStream;
      window.__nxYardScanStream = null;
      if (stream && v.scan && v.scan.torchOn) {
        try { await scanner.setTorch(stream, false); } catch (e) { /* best effort */ }
      }
      if (stream) scanner.stopCamera(stream);
      if (v.scan && (v.scan.open || v.scan.reading || v.scan.torchOn)) {
        v.scan = Object.assign({}, v.scan, { open: false, reading: false, torch: false, torchOn: false });
      }
    }
  }

  return closeScannerChain;
});
