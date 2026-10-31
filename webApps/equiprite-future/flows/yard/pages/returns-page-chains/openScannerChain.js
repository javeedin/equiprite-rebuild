define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/unitScanner',
], (ActionChain, Actions, scanner) => {
  'use strict';

  // Opens the camera and looks for a barcode or QR tag (New's OpenScannerChain, resources/js/unitScanner copied
  // unchanged). A barcode is an exact read: it fills the box and searches at once. The stream is torn down by
  // closeScannerChain (on a hit, on Stop, when the panel closes and when the page goes).
  function waitForEl(id, timeoutMs) {
    return new Promise((resolve) => {
      const started = Date.now();
      (function look() {
        const el = document.getElementById(id);
        if (el) return resolve(el);
        if (Date.now() - started > timeoutMs) return resolve(null);
        return setTimeout(look, 60);
      }());
    });
  }

  function cameraErrorMessage(e) {
    const name = (e && e.name) || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission was refused. Allow it in the browser, then try again.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera found on this device.';
    if (name === 'NotReadableError') return 'The camera is in use by another app.';
    return (e && e.message) || 'Could not start the camera.';
  }

  class openScannerChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const probe = scanner.isCameraAvailable();
      if (!probe.ok) {
        v.scan = Object.assign({}, v.scan, { supported: false, open: false, status: probe.message });
        return;
      }
      v.scan = Object.assign({}, v.scan, { open: true, status: 'Starting the camera…' });
      const video = await waitForEl('ydrScanVideo', 3000);
      if (!video) {
        v.scan = Object.assign({}, v.scan, { open: false, status: 'Could not open the viewfinder.' });
        return;
      }
      let stream;
      try {
        stream = await scanner.openCamera();
      } catch (e) {
        console.warn('[openScannerChain] camera refused:', e);
        v.scan = Object.assign({}, v.scan, { open: false, status: cameraErrorMessage(e) });
        return;
      }
      window.__nxYardScanStream = stream;
      video.srcObject = stream;
      try { await video.play(); } catch (e) { /* muted + playsinline cover autoplay */ }
      v.scan = Object.assign({}, v.scan, { torchOn: false, torch: scanner.hasTorch(stream), status: 'Point the camera at the barcode or QR tag.' });
      window.__nxYardScanHandle = scanner.scanBarcode(video, (value) => {
        v.findQuery = value;
        v.scan = Object.assign({}, v.scan, { status: 'Scanned ' + value });
        Actions.callChain(context, { chain: 'closeScannerChain' })
          .then(() => Actions.callChain(context, { chain: 'findChain', params: {} }))
          .catch((err) => console.warn('[openScannerChain] after the scan:', err));
      }, (err) => {
        console.warn('[openScannerChain] scanner error:', err);
        v.scan = Object.assign({}, v.scan, { status: 'The barcode reader is not available: use Read serial text, or type it.' });
      });
    }
  }

  return openScannerChain;
});
