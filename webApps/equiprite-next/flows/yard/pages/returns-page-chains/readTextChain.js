define([
  'vb/action/actionChain',
  'resources/js/unitScanner',
], (ActionChain, scanner) => {
  'use strict';

  // Reads a serial plate as text when there is no barcode (New's ReadSerialTextChain). Text recognition misreads
  // plausible serials (G/6, 8/B, 0/O), so the read only fills the box: the operator checks it, then searches.
  class readTextChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const video = document.getElementById('ydrScanVideo');
      if (!video || !video.videoWidth) {
        v.scan = Object.assign({}, v.scan, { status: 'Wait for the picture, then try again.' });
        return;
      }
      v.scan = Object.assign({}, v.scan, { reading: true, status: 'Reading the serial… (the first time downloads the reader)' });
      let result;
      try {
        result = await scanner.readTextFromVideo(video);
      } catch (e) {
        console.warn('[readTextChain] text reading failed:', e);
        v.scan = Object.assign({}, v.scan, { reading: false, status: 'Could not read the text. Type the serial instead.' });
        return;
      }
      const text = (result && result.text) || '';
      if (!text) {
        v.scan = Object.assign({}, v.scan, { reading: false, status: 'No readable text. Fill the frame with the plate and hold steady.' });
        return;
      }
      v.findQuery = text;
      const conf = Math.round((result && result.confidence) || 0);
      v.scan = Object.assign({}, v.scan, { reading: false, status: conf && conf < 70
        ? 'Read "' + text + '" but the picture was poor: check it, then Search.'
        : 'Read "' + text + '": check it against the plate, then Search.' });
    }
  }

  return readTextChain;
});
