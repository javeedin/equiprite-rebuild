define([
  'vb/action/actionChain',
  'resources/js/unitScanner',
], (ActionChain, scanner) => {
  'use strict';

  // Stops scanning and releases the camera (Next's closeScannerChain): the decode loop first, then the video, the
  // torch and the tracks. Safe to run twice and when no camera was opened. The sheet itself is closed by sheetChain.
  class scanCloseChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const handle = window.__mbPickScanHandle;
      window.__mbPickScanHandle = null;
      if (handle && typeof handle.stop === 'function') {
        try { handle.stop(); } catch (e) { /* already stopped */ }
      }
      const video = document.getElementById('pkScanVideo');
      if (video) {
        try { video.pause(); } catch (e) { /* ignore */ }
        video.srcObject = null;
      }
      const stream = window.__mbPickScanStream;
      window.__mbPickScanStream = null;
      if (stream && v.scan && v.scan.torchOn) {
        try { await scanner.setTorch(stream, false); } catch (e) { /* best effort */ }
      }
      if (stream) scanner.stopCamera(stream);
      if (v.scan && (v.scan.open || v.scan.torchOn)) {
        v.scan = Object.assign({}, v.scan, { open: false, torch: false, torchOn: false, status: v.sheet === 'scan' ? 'The camera stopped.' : '' });
      }
    }
  }

  return scanCloseChain;
});
