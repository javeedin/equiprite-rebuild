define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/unitScanner',
], (ActionChain, Actions, scanner) => {
  'use strict';

  // The scanner sheet: the camera looking for a unit's barcode or QR tag (Next's openScannerChain, resources/js/
  // unitScanner unchanged), and a box to type the unit number (or for a tag reader, which types it). Each tag read is
  // ticked (scanHitChain); the camera then keeps looking for the next piece while the sheet is open, so a person can
  // walk the yard scanning one piece after another. With no camera here the sheet says why and the box still works.
  // The stream is torn down by scanCloseChain (the sheet closing, the page hidden or left).
  const NEXT_READ_MS = 900;

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

  class scanOpenChain extends ActionChain {
    async run(context, { warm } = {}) {
      const v = context.$page.variables;
      if (warm || v.busy) return;
      if (v.scan && v.scan.open && v.sheet === 'scan') return;
      v.unitText = '';
      v.scan = Object.assign({}, v.scan, { open: false, supported: true, torch: false, torchOn: false, status: 'Starting the camera…' });
      v.sheet = 'scan';
      const probe = scanner.isCameraAvailable();
      if (!probe.ok) {
        v.scan = Object.assign({}, v.scan, { supported: false, status: probe.message });
        return;
      }
      const video = await waitForEl('pkScanVideo', 3000);
      if (!video || v.sheet !== 'scan') {
        v.scan = Object.assign({}, v.scan, { status: 'Could not open the viewfinder: type the unit number.' });
        return;
      }
      let stream;
      try {
        stream = await scanner.openCamera();
      } catch (e) {
        v.scan = Object.assign({}, v.scan, { open: false, status: cameraErrorMessage(e) });
        return;
      }
      if (v.sheet !== 'scan') {
        scanner.stopCamera(stream);
        return;
      }
      window.__mbPickScanStream = stream;
      video.srcObject = stream;
      try { await video.play(); } catch (e) { /* muted + playsinline cover autoplay */ }
      v.scan = Object.assign({}, v.scan, { open: true, torchOn: false, torch: scanner.hasTorch(stream), status: 'Point the camera at a unit’s tag.' });
      const look = () => {
        window.__mbPickScanHandle = scanner.scanBarcode(video, (value) => {
          Actions.callChain(context, { chain: 'scanHitChain', params: { value, source: 'camera' } })
            .catch((err) => console.warn('[scanOpenChain] after the scan:', err))
            .then(() => setTimeout(() => {
              if (window.__mbPickScanStream === stream && v.sheet === 'scan') look();
            }, NEXT_READ_MS));
        }, () => {
          v.scan = Object.assign({}, v.scan, { status: 'The tag reader is not available here: type the unit number.' });
        });
      };
      look();
    }
  }

  return scanOpenChain;
});
