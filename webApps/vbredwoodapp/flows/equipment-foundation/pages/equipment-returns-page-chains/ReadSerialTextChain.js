define([
  'vb/action/actionChain',
  'resources/js/unitScanner',
], (ActionChain, scanner) => {
  'use strict';

  /**
   * OCR the current frame — read the serial as TEXT when there is no barcode.
   *
   * ── WHY THIS DOES NOT SEARCH ──────────────────────────────────────────────
   * Tesseract on a stamped or etched serial plate runs ~87.5% accurate PER
   * CHARACTER even after preprocessing. Across a 10-character serial that is
   * roughly a 26% chance the whole string is right, and the usual failures are
   * G/6, 8/B and 0/O — which produce a plausible WRONG serial, not an obvious
   * error. Outdoor metal is near its worst case: no ink, only shadow in the
   * depression, plus glare and rotation.
   *
   * So the read is put in the box and the operator confirms it. Searching
   * automatically on a misread could match a different unit and return the
   * wrong rental, freeing equipment that is still on site. That is exactly the
   * failure the whole Direct Return design is built to avoid — it is why the
   * results grid never auto-selects either, even for a single match.
   *
   * The camera stays open afterwards so a bad read can simply be retried.
   */
  class ReadSerialTextChain extends ActionChain {
    async run(context) {
      const { $page } = context;

      const video = document.getElementById('directReturnVideo');
      if (!video || !video.videoWidth) {
        $page.variables.scanStatus = 'Wait for the picture, then try again.';
        return;
      }

      $page.variables.scanReadingText = true;
      // First use downloads the WASM core plus language data (~5 MB), which on
      // yard wifi is slow enough that silence would read as a hang.
      $page.variables.scanStatus = 'Reading the serial… (first use downloads the reader)';

      let result;
      try {
        result = await scanner.readTextFromVideo(video);
      } catch (e) {
        console.warn('[ReadSerialTextChain] OCR failed:', e);
        $page.variables.scanReadingText = false;
        $page.variables.scanStatus = 'Could not read the text. Type the serial instead.';
        return;
      }

      $page.variables.scanReadingText = false;

      const text = (result && result.text) || '';
      if (!text) {
        $page.variables.scanStatus =
          'No readable text. Fill the frame with the plate and hold steady.';
        return;
      }

      // Fill, do NOT search. The operator checks it against the plate.
      $page.variables.directReturnQuery = text;

      const conf = Math.round((result && result.confidence) || 0);
      $page.variables.scanStatus = conf && conf < 70
        ? 'Read "' + text + '" but the image was poor — check it, then Search.'
        : 'Read "' + text + '" — check it against the plate, then Search.';
    }
  }

  return ReadSerialTextChain;
});
