define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/unitScanner',
], (ActionChain, Actions, scanner) => {
  'use strict';

  /**
   * Open the camera and start looking for a barcode.
   *
   * On a hit the decoded value goes straight into the search box and the
   * search runs immediately — a barcode is an exact machine read, so there is
   * nothing for the operator to confirm. That is the opposite of the OCR path
   * (ReadSerialTextChain), which only ever suggests.
   *
   * The stream is owned by this chain and torn down by CloseScannerChain. It
   * is parked on window rather than a page variable because a MediaStream is
   * a live object, not state VB should be serialising or diffing.
   */
  class OpenScannerChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const probe = scanner.isCameraAvailable();
      if (!probe.ok) {
        // Should be unreachable — the button is hidden when unsupported — but
        // a keyboard or DOM route must still land somewhere sensible.
        $page.variables.scanSupported = false;
        $page.variables.scanStatus = probe.message;
        return;
      }

      $page.variables.scanOpen = true;
      $page.variables.scanStatus = 'Starting camera…';

      // The <video> is created by the oj-bind-if above, so it does not exist
      // until VB has re-rendered. Wait for it rather than guessing a delay.
      const video = await waitForEl('directReturnVideo', 3000);
      if (!video) {
        $page.variables.scanStatus = 'Could not open the viewfinder.';
        $page.variables.scanOpen = false;
        return;
      }

      let stream;
      try {
        stream = await scanner.openCamera();
      } catch (e) {
        console.warn('[OpenScannerChain] camera refused:', e);
        $page.variables.scanStatus = cameraErrorMessage(e);
        $page.variables.scanOpen = false;
        return;
      }

      window.__eqrScanStream = stream;
      video.srcObject = stream;
      try { await video.play(); } catch (e) { /* autoplay guard; muted+playsinline covers it */ }

      // Torch is a per-DEVICE capability read off the live track: phones and
      // most tablets have one, laptops never do. Offering a dead lamp button
      // on a laptop would be the same mistake as offering a camera button on
      // an insecure origin, so the control is gated on the real capability.
      $page.variables.scanTorchOn = false;
      $page.variables.scanTorchAvailable = scanner.hasTorch(stream);

      $page.variables.scanStatus = 'Point the camera at the barcode or QR tag.';

      window.__eqrScanHandle = scanner.scanBarcode(
        video,
        (value) => {
          // A barcode is exact — fill and search without asking.
          $page.variables.directReturnQuery = value;
          $page.variables.scanStatus = 'Scanned ' + value;
          Actions.callChain(context, { chain: 'CloseScannerChain' })
            .then(() => Actions.callChain(context, { chain: 'DirectReturnSearchChain' }))
            .catch(err => console.warn('[OpenScannerChain] post-scan failed:', err));
        },
        (err) => {
          console.warn('[OpenScannerChain] scanner error:', err);
          $page.variables.scanStatus =
            'Barcode reader unavailable. Use "Read serial text", or type it.';
        }
      );
    }
  }

  // Poll for an element the binding is about to create.
  function waitForEl(id, timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      (function look() {
        const el = document.getElementById(id);
        if (el) return resolve(el);
        if (Date.now() - started > timeoutMs) return resolve(null);
        setTimeout(look, 60);
      })();
    });
  }

  // getUserMedia rejections are actionable, so say which one it was.
  function cameraErrorMessage(e) {
    const name = (e && e.name) || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Camera permission was refused. Allow it in the browser, then try again.';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return 'No camera found on this device.';
    }
    if (name === 'NotReadableError') {
      return 'The camera is in use by another app.';
    }
    return (e && e.message) || 'Could not start the camera.';
  }

  return OpenScannerChain;
});
