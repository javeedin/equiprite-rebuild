define([], function () {
  'use strict';

  // EquipRite for Android's own scanner (android/…/ScanActivity.java), for a page served over the PC's Wi-Fi: there
  // the browser's camera is not available (plain http), so the app scans and hands the text back to the page as the
  // "equiprite-scan" event ({ text }, '' when cancelled). Elsewhere (a browser, VBCS) the page uses its own camera.
  var waiting = null;

  function onResult(e) {
    var done = waiting;
    waiting = null;
    if (done) done(String((e && e.detail && e.detail.text) || ''));
  }
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('equiprite-scan', onResult);

  /** Whether the app's scanner is here (EquipRite for Android 1.1 and later). */
  function available(win) {
    var w = win || (typeof window !== 'undefined' ? window : null);
    return !!(w && w.EquipRiteApp && typeof w.EquipRiteApp.scan === 'function');
  }

  /** Opens the app's scanner: resolves the text read, or '' (cancelled, or no scanner). */
  function scan(prompt, win) {
    var w = win || (typeof window !== 'undefined' ? window : null);
    if (!available(w)) return Promise.resolve('');
    if (waiting) onResult({ detail: { text: '' } });
    return new Promise(function (resolve) {
      waiting = resolve;
      try {
        w.EquipRiteApp.scan(String(prompt || ''));
      } catch (e) {
        waiting = null;
        resolve('');
      }
    });
  }

  /** Whether version a ("1.10") is newer than b ("1.9"). */
  function newer(a, b) {
    var x = String(a || '').split('.').map(Number);
    var y = String(b || '').split('.').map(Number);
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var p = x[i] || 0, q = y[i] || 0;
      if (p !== q) return p > q;
    }
    return false;
  }

  return { available: available, scan: scan, newer: newer, onResult: onResult };
});
