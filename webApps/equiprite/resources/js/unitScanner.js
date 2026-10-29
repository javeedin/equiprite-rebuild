define([], function () {
  'use strict';

  /**
   * UNIT SCANNER — read a unit's identity with the device camera.
   *
   * Feeds the Direct Return search box. The operator is standing next to a
   * machine holding a phone, or at a returns desk with a webcam, and needs the
   * serial into the search field without typing it off a dirty plate.
   *
   * Three ways in, in descending order of reliability:
   *
   *   1. BarcodeDetector  — the browser's native decoder. Free, instant, no
   *                         download. Absent on most desktops (see below).
   *   2. ZXing            — JS fallback covering the same 1D + QR formats,
   *                         loaded from the CDN on demand.
   *                         NOT vendored: a local copy was tried and had to be
   *                         removed. VBCS transpiles everything under
   *                         resources/js through Babel with no way to opt out
   *                         (Transpiler.getResourcesToTranspile excludes only
   *                         a `bundles/plain/` path), and the 362 KB
   *                         single-line minified bundle failed with
   *                         "Duplicate declaration n" and then OOM'd the
   *                         build. So the scanner needs network to decode
   *                         where BarcodeDetector is absent.
   *   3. OCR (Tesseract)  — reads the serial as TEXT when there is no barcode
   *                         at all. Suggestion only; never auto-searches.
   *
   * ── WORKING ON EVERY DEVICE ───────────────────────────────────────────────
   * Laptop, tablet and phone all reach a working decoder, by different routes:
   *
   *   phone / tablet  native detector where present, else ZXing; rear lens,
   *                   continuous focus, torch where the device has one
   *   laptop          no native detector on Windows/Linux, so ZXing does the
   *                   work; front webcam, no torch, and resolution is REQUESTED
   *                   because a default 640x480 will not resolve Code128 bars
   *
   * Path 1 hands over to path 2 if it decodes nothing within a few seconds of
   * real frames: a detector can build successfully and still be unable to read
   * the label actually on the machine, and polling it forever would strand the
   * operator with the working decoder one branch away. Every device therefore
   * ends up on a decoder that can read the tag, or is told plainly that it
   * cannot scan — never left aiming at a viewfinder that can never succeed.
   *
   * ── WHY THE FALLBACK IS THE MAIN PATH, NOT AN EDGE CASE ───────────────────
   * `window.BarcodeDetector` does NOT exist in Chrome or Edge on Windows or
   * Linux — it ships only on ChromeOS, macOS and Android (MDN browser-compat
   * 8.1.1). Firefox has never shipped it; Safari 17 has it behind a disabled
   * flag. So on a Windows dev machine the native path never runs and ZXing is
   * what executes. Testing on an Android phone proves nothing about desktop,
   * and vice versa. Both paths must be exercised.
   *
   * Feature detection is also not just `'BarcodeDetector' in window`: the
   * macOS and ChromeOS backends expose different format lists, so the
   * supported formats are checked too before the native path is trusted.
   *
   * ── WHY OCR IS DELIBERATELY SECOND-CLASS ──────────────────────────────────
   * Published accuracy for Tesseract on stamped/etched serial plates runs
   * ~87.5% PER CHARACTER even after preprocessing. Over a 10-character serial
   * that is roughly a 26% chance of a wholly correct read, and the
   * characteristic failures are G/6, 8/B, 0/O — corruptions that look like a
   * valid serial rather than an obvious error. Outdoor stamped metal is close
   * to the worst case for it: no ink, just shadow in the depression, plus
   * glare and arbitrary rotation.
   *
   * Therefore OCR NEVER triggers a search on its own. It fills the box and the
   * operator confirms. A wrong read that auto-searched and auto-matched would
   * return the wrong rental and free equipment still on site.
   *
   * ── SECURE CONTEXT ────────────────────────────────────────────────────────
   * getUserMedia requires a secure context, and when it is unavailable
   * `navigator.mediaDevices` is UNDEFINED rather than throwing — so it is
   * guarded with optional access, not a try/catch on a promise.
   *
   * `http://localhost` IS a secure context, so the local dev server works.
   * `http://<LAN-IP>:8080` is NOT — which is exactly how you would reach the
   * dev server from a real phone. Testing the camera on a handset needs a
   * tunnel or a dev certificate; the camera will silently not exist otherwise.
   * isCameraAvailable() reports that distinctly so the UI can say why.
   */

  // UMD/AMD modules pulled on demand. Not in app-flow.json requirejs.paths on
  // purpose: they are only fetched when the operator actually opens the
  // scanner, so the 108 KB (ZXing) and ~5 MB (Tesseract runtime + language
  // data) never load for the many sessions that never scan anything.
  var ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.23.0/umd/index.min.js';
  var TESSERACT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/7.0.0/tesseract.min.js';

  // Formats worth trying. Equipment tags in this fleet are Code128/Code39
  // asset labels or QR; the rest cost nothing to include.
  var FORMATS = [
    'code_128', 'code_39', 'code_93', 'codabar', 'itf',
    'ean_13', 'ean_8', 'upc_a', 'upc_e',
    'qr_code', 'data_matrix', 'pdf417', 'aztec'
  ];

  // How long the NATIVE detector gets before the ZXing fallback takes over.
  // Both must be exceeded: frames alone would trip on a fast camera that has
  // not been aimed yet, time alone on a slow one still warming up. ~3 s of
  // real frames is several seconds of an operator holding a tag up — long
  // enough to be a fair trial, short enough not to read as broken.
  var NATIVE_GIVEUP_FRAMES = 12;
  var NATIVE_GIVEUP_MS = 3000;

  // ── module loading ────────────────────────────────────────────────────────

  var _scriptCache = {};
  var _moduleCache = {};

  /**
   * Load a module by its requirejs NAME first, falling back to a URL.
   *
   * Nothing is registered under `zxing` any more (see the note above — the
   * vendored bundle broke the VBCS build), so the name lookup misses and the
   * CDN branch is what runs. The lookup is kept because it costs one failed
   * requirejs resolve and lets a vendored copy be restored by adding the
   * path back to app-flow.json, if a transpile-safe build is ever produced.
   *
   * NOTE the UMD order in @zxing/library: it checks `define.amd` BEFORE the
   * global branch, so under requirejs it registers as an anonymous module and
   * `window.ZXing` is never set. The object requirejs hands back is therefore
   * the ONLY reference — verified against the vendored bundle.
   */
  function loadModule(name, url, globalName) {
    if (_moduleCache[name]) return _moduleCache[name];

    _moduleCache[name] = new Promise(function (resolve, reject) {
      if (window[globalName]) return resolve(window[globalName]);

      if (typeof window.require === 'function') {
        try {
          window.require([name], function (mod) {
            if (mod || window[globalName]) resolve(mod || window[globalName]);
            else fromUrl();
          }, function () {
            // Not registered, or the vendored file is missing from this build.
            fromUrl();
          });
          return;
        } catch (e) { /* fall through */ }
      }
      fromUrl();

      function fromUrl() {
        loadScript(url, globalName).then(resolve, reject);
      }
    }).catch(function (e) {
      delete _moduleCache[name];   // let a later attempt retry
      throw e;
    });

    return _moduleCache[name];
  }

  // Loads a UMD bundle. RequireJS is on the page, so a script with an AMD
  // branch would register itself as an anonymous module and throw a mismatch
  // error if injected with a plain tag. Route through require() when it is
  // present and let it handle the define() call.
  function loadScript(url, globalName) {
    if (_scriptCache[url]) return _scriptCache[url];

    _scriptCache[url] = new Promise(function (resolve, reject) {
      if (window[globalName]) return resolve(window[globalName]);

      // NOTE: an AMD-aware bundle registers itself as a module and never
      // touches window - verified: @zxing/library loads through requirejs
      // with window.ZXing still undefined. So the module object requirejs
      // hands back is the ONLY reference, and the global check below is just
      // the plain-tag fallback for bundles without an AMD branch.
      if (typeof window.require === 'function') {
        try {
          window.require([url], function (mod) {
            resolve(mod || window[globalName]);
          }, function () {
            // requirejs failed (CSP, network) — fall through to a plain tag.
            tagLoad();
          });
          return;
        } catch (e) {
          // fall through
        }
      }
      tagLoad();

      function tagLoad() {
        var s = document.createElement('script');
        s.src = url;
        s.async = true;
        s.onload = function () {
          if (window[globalName]) resolve(window[globalName]);
          else reject(new Error('loaded ' + url + ' but no global ' + globalName));
        };
        s.onerror = function () { reject(new Error('could not load ' + url)); };
        document.head.appendChild(s);
      }
    }).catch(function (e) {
      delete _scriptCache[url];   // let a later attempt retry
      throw e;
    });

    return _scriptCache[url];
  }

  // ── capability probes ─────────────────────────────────────────────────────

  /**
   * Why the camera is or is not usable here. The UI needs the REASON, not just
   * a boolean, so it can tell an operator on a LAN IP that the problem is the
   * URL rather than their device.
   *
   * @returns {{ok: boolean, reason: string, message: string}}
   */
  function isCameraAvailable() {
    if (!window.isSecureContext) {
      return {
        ok: false,
        reason: 'insecure',
        message: 'The camera needs a secure (https) connection. ' +
                 'Open this page over https, or on localhost.'
      };
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return {
        ok: false,
        reason: 'unsupported',
        message: 'This browser cannot open the camera. Type the serial instead.'
      };
    }
    return { ok: true, reason: '', message: '' };
  }

  // Native decoder, or null. Checks the FORMAT LIST too — the macOS and
  // ChromeOS backends do not expose the same set, so a bare existence check
  // can hand back a detector that cannot read our asset tags.
  function nativeDetector() {
    if (!('BarcodeDetector' in window)) return Promise.resolve(null);
    return window.BarcodeDetector.getSupportedFormats()
      .then(function (supported) {
        var usable = FORMATS.filter(function (f) { return supported.indexOf(f) !== -1; });
        if (!usable.length) return null;
        return new window.BarcodeDetector({ formats: usable });
      })
      .catch(function () { return null; });
  }

  // ── camera ────────────────────────────────────────────────────────────────

  /**
   * Open a camera stream, preferring the rear lens.
   *
   * `ideal` not `exact`: exact is MANDATORY and rejects with
   * OverconstrainedError on a desktop that has only a front webcam — without
   * even prompting the user. `ideal` degrades to whatever camera exists, so
   * one code path serves phone and desktop.
   */
  function openCamera() {
    var probe = isCameraAvailable();
    if (!probe.ok) return Promise.reject(Object.assign(new Error(probe.message), probe));

    // Resolution is requested, not demanded. A laptop webcam left to its own
    // devices commonly negotiates 640x480, which is too coarse for the narrow
    // bars of a Code128 asset tag at arm's length — the decoder then never
    // resolves a label a phone reads instantly. `ideal` lets a weak camera
    // give what it has instead of failing outright, so one path serves phone,
    // tablet and laptop.
    var preferred = {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 1920 },
      height: { ideal: 1080 },
      // Continuous refocus matters most on phones held close to a plate;
      // cameras without it ignore the hint rather than rejecting.
      focusMode: { ideal: 'continuous' }
    };

    return navigator.mediaDevices.getUserMedia({ video: preferred, audio: false })
      .catch(function (err) {
        // Some Android devices with unusual multi-camera setups misreport
        // facingMode; a few browsers reject the unknown focusMode outright.
        // Step down rather than give up — a working 640x480 stream still
        // decodes a tag held closer.
        if (err && (err.name === 'OverconstrainedError' ||
                    err.name === 'NotFoundError' ||
                    err.name === 'TypeError')) {
          return navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } }, audio: false
          }).catch(function (err2) {
            if (err2 && (err2.name === 'OverconstrainedError' || err2.name === 'NotFoundError')) {
              // Last resort: whatever camera exists. This is the laptop with
              // only a front-facing webcam.
              return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            }
            throw err2;
          });
        }
        throw err;
      });
  }

  /**
   * Turn the torch on or off, where the device has one.
   *
   * Phones and most tablets expose it; laptops do not. Yard returns happen in
   * a shed or at dusk as often as not, and an unlit stamped tag is the single
   * most common reason a barcode will not resolve.
   *
   * @returns {Promise<boolean>} whether the torch is now on. Resolves false
   *   rather than rejecting when the device has no torch — the caller shows a
   *   control only when hasTorch() says so, and a race must not throw.
   */
  function setTorch(stream, on) {
    return new Promise(function (resolve) {
      var track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
      if (!track || typeof track.applyConstraints !== 'function') return resolve(false);
      track.applyConstraints({ advanced: [{ torch: !!on }] })
        .then(function () { resolve(!!on); })
        .catch(function () { resolve(false); });
    });
  }

  /** Whether this stream's camera reports a torch. False on every laptop. */
  function hasTorch(stream) {
    try {
      var track = stream && stream.getVideoTracks && stream.getVideoTracks()[0];
      if (!track || typeof track.getCapabilities !== 'function') return false;
      var caps = track.getCapabilities();
      return !!(caps && 'torch' in caps && caps.torch);
    } catch (e) {
      return false;   // getCapabilities is absent on Firefox and older Safari
    }
  }

  function stopCamera(stream) {
    if (!stream) return;
    try {
      stream.getTracks().forEach(function (t) { t.stop(); });
    } catch (e) { /* already gone */ }
  }

  // ── barcode scanning ──────────────────────────────────────────────────────

  /**
   * Poll a <video> for a barcode until one is found or stop() is called.
   *
   * @param {HTMLVideoElement} video   playing the camera stream
   * @param {Function} onResult        called once with the decoded string
   * @param {Function} [onError]       called with a fatal setup error
   * @returns {{stop: Function}}       stop() halts the loop and is idempotent
   */
  function scanBarcode(video, onResult, onError) {
    var stopped = false;
    var timer = null;
    // Teardown callbacks registered by whichever decoder ends up running.
    // A list rather than reassigning halt(), so stop() has exactly one
    // meaning no matter which path is active when it is called.
    var teardown = [];

    function halt() {
      stopped = true;
      if (timer) { clearTimeout(timer); timer = null; }
      teardown.splice(0).forEach(function (fn) {
        try { fn(); } catch (e) { /* best effort */ }
      });
    }

    nativeDetector().then(function (det) {
      if (stopped) return;
      if (det) return loopNative(det);
      return loopZXing();
    }).catch(function (e) {
      if (!stopped && onError) onError(e);
    });

    // 1. Native — cheapest, but absent on Windows/Linux desktop.
    //
    // HANDS OVER TO ZXING IF IT READS NOTHING. A detector that builds fine can
    // still never decode: the backend's format support is coarser than the
    // label actually on the machine, and some Android builds decode QR well but
    // miss the Code128/Code39 asset tags this fleet uses. Polling it forever
    // would leave the operator staring at a viewfinder that can never succeed,
    // with the working decoder one branch away and never tried.
    function loopNative(det) {
      var startedAt = Date.now();
      var frames = 0;
      var handedOver = false;

      function handOver() {
        if (handedOver || stopped) return;
        handedOver = true;
        if (timer) { clearTimeout(timer); timer = null; }
        loopZXing().catch(function (e) {
          if (!stopped && onError) onError(e);
        });
      }

      function tick() {
        if (stopped || handedOver) return;
        if (video.readyState < 2) { timer = setTimeout(tick, 120); return; }
        // Give the native path a fair run on real frames, then defer. Counting
        // DECODED FRAMES as well as elapsed time so a slow camera warming up
        // is not mistaken for a detector that cannot read the tag.
        if (frames >= NATIVE_GIVEUP_FRAMES && Date.now() - startedAt > NATIVE_GIVEUP_MS) {
          return handOver();
        }
        det.detect(video).then(function (codes) {
          if (stopped || handedOver) return;
          frames++;
          if (codes && codes.length && codes[0].rawValue) {
            halt();
            onResult(String(codes[0].rawValue).trim());
          } else {
            timer = setTimeout(tick, 160);
          }
        }).catch(function () {
          // A per-frame failure is not fatal — keep going. Repeated failures
          // are caught by the give-up check above.
          if (!stopped && !handedOver) { frames++; timer = setTimeout(tick, 250); }
        });
      }
      tick();
    }

    // 2. ZXing — the real path on desktop Chrome/Edge for Windows, and the
    //    safety net everywhere else. Loaded from the CDN on demand, not
    //    vendored (see the note at the top of this file for why).
    //
    //    MUST be decodeFromVideoElementCONTINUOUSLY. The plain
    //    decodeFromVideoElement(video) takes ONE argument and decodes ONCE,
    //    returning a promise; passing it a callback silently drops the
    //    callback, so onResult never fires and the operator is left aiming at
    //    a viewfinder forever. The two differ only by the suffix, which is
    //    exactly why it went unnoticed:
    //        decodeFromVideoElement              arity 1  — one-shot promise
    //        decodeFromVideoElementContinuously  arity 2  — (element, callback)
    function loopZXing() {
      return loadModule('zxing', ZXING_URL, 'ZXing').then(function (ZXing) {
        if (stopped) return;
        var reader = new ZXing.BrowserMultiFormatReader();
        reader.decodeFromVideoElementContinuously(video, function (result, err) {
          if (stopped) return;
          if (result) {
            halt();
            try { reader.reset(); } catch (e) { /* ignore */ }
            onResult(String(result.getText()).trim());
          }
          // err on most frames just means "nothing in view" — ignore it.
        });
        // Make stop() tear the reader down too. Re-check stopped: halt() may
        // have run while the CDN fetch above was in flight, in which case it
        // has already drained teardown and nothing would ever read this entry.
        if (stopped) { try { reader.reset(); } catch (e) { /* ignore */ } return; }
        teardown.push(function () { reader.reset(); });
      });
    }

    return { stop: function () { halt(); } };
  }

  // ── OCR ───────────────────────────────────────────────────────────────────

  /**
   * Read text from a single still frame.
   *
   * SUGGESTION ONLY. See the header: ~87.5% per-character on stamped metal
   * means a full serial is more often wrong than right, and the failure mode
   * is a plausible-looking wrong string. The caller must put this in the box
   * for the operator to check, never search on it directly.
   *
   * Downloads ~5 MB on first use (WASM core + language data), so it is only
   * ever called on an explicit "read the text" action.
   *
   * @returns {Promise<{text: string, confidence: number}>}
   */
  function readTextFromVideo(video) {
    return loadScript(TESSERACT_URL, 'Tesseract').then(function (Tesseract) {
      var canvas = document.createElement('canvas');
      var w = video.videoWidth || 1280;
      var h = video.videoHeight || 720;

      // Crop to the middle band — the operator aims the plate at the centre,
      // and cutting the surrounding machine out removes most of what OCR
      // would otherwise hallucinate words from.
      var cropH = Math.round(h * 0.35);
      var cropY = Math.round((h - cropH) / 2);
      canvas.width = w;
      canvas.height = cropH;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, cropY, w, cropH, 0, 0, w, cropH);

      // Grayscale + contrast stretch. Stamped metal has no ink: the only
      // signal is shadow in the depression, so widening the histogram is what
      // makes the characters separable at all.
      try {
        var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var d = img.data;
        var i;
        var min = 255, max = 0;
        for (i = 0; i < d.length; i += 4) {
          var g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
          d[i] = d[i + 1] = d[i + 2] = g;
          if (g < min) min = g;
          if (g > max) max = g;
        }
        var span = Math.max(1, max - min);
        for (i = 0; i < d.length; i += 4) {
          var v = ((d[i] - min) * 255 / span) | 0;
          d[i] = d[i + 1] = d[i + 2] = v < 0 ? 0 : (v > 255 ? 255 : v);
        }
        ctx.putImageData(img, 0, 0);
      } catch (e) {
        // Tainted canvas or no 2d context — OCR the untouched frame.
      }

      return Tesseract.recognize(canvas, 'eng', {
        // Serials in this fleet are upper-case alphanumeric with dashes.
        // Constraining the alphabet removes a whole class of misreads.
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'
      }).then(function (res) {
        var data = (res && res.data) || {};
        return {
          text: cleanOcrText(data.text || ''),
          confidence: typeof data.confidence === 'number' ? data.confidence : 0
        };
      });
    });
  }

  // Pick the most serial-looking token out of the OCR blob. Tesseract returns
  // whatever it saw across the whole crop, including stray marks read as
  // single characters, so the longest alphanumeric run is a better guess than
  // the raw string.
  function cleanOcrText(raw) {
    var tokens = String(raw)
      .toUpperCase()
      .replace(/[^A-Z0-9\-\s]/g, ' ')
      .split(/\s+/)
      .filter(function (t) { return t.replace(/-/g, '').length >= 4; });
    if (!tokens.length) return '';
    tokens.sort(function (a, b) { return b.length - a.length; });
    return tokens[0];
  }

  return {
    isCameraAvailable: isCameraAvailable,
    openCamera: openCamera,
    stopCamera: stopCamera,
    scanBarcode: scanBarcode,
    hasTorch: hasTorch,
    setTorch: setTorch,
    readTextFromVideo: readTextFromVideo,
    // exposed for testing
    cleanOcrText: cleanOcrText
  };
});
