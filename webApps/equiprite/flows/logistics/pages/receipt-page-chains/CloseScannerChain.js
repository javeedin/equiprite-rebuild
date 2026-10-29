define([
  'vb/action/actionChain',
  'resources/js/unitScanner',
], (ActionChain, scanner) => {
  'use strict';

  /**
   * Stop scanning and release the camera.
   *
   * Must run on EVERY exit — cancel, a successful scan, and closing the whole
   * dialog. A MediaStream left running keeps the camera light on and holds the
   * device open against other apps, which on a phone reads as the app spying.
   * Hence CloseDirectReturnChain calls this too.
   *
   * Written to be safe to call twice: the operator can hit Cancel while a scan
   * is already completing.
   */
  class CloseScannerChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      // 1. Stop the decode loop first, so it cannot fire a result against a
      //    stream that is about to be torn down.
      const handle = window.__eqrScanHandle;
      window.__eqrScanHandle = null;
      if (handle && typeof handle.stop === 'function') {
        try { handle.stop(); } catch (e) { console.warn('[CloseScannerChain] stop failed:', e); }
      }

      // 2. Detach the element from the stream before stopping the tracks;
      //    Safari can otherwise hold a black frame on the video.
      const video = document.getElementById('directReturnVideo');
      if (video) {
        try { video.pause(); } catch (e) { /* ignore */ }
        video.srcObject = null;
      }

      // 3. Release the hardware. Douse the torch FIRST — stopping a track with
      //    the lamp lit leaves it on until the OS reclaims the camera on some
      //    Android builds, which to the operator looks like the app left their
      //    flashlight running.
      const stream = window.__eqrScanStream;
      window.__eqrScanStream = null;
      if (stream && $page.variables.scanTorchOn) {
        try { await scanner.setTorch(stream, false); } catch (e) { /* best effort */ }
      }
      scanner.stopCamera(stream);

      $page.variables.scanOpen = false;
      $page.variables.scanReadingText = false;
      $page.variables.scanTorchOn = false;
      $page.variables.scanTorchAvailable = false;
    }
  }

  return CloseScannerChain;
});
