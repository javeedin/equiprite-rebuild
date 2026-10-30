define([], function () {
  'use strict';

  // EquipRite on your phone, from the toolbar: the address a phone opens EquipRite Mobile at, and its QR code. Scanned
  // with the phone's camera, it opens the app, which offers to put itself on the home screen (from=qr).
  //
  //   Under VBCS          Mobile's own address (appUrls.mobile, https): any phone, anywhere; it installs, and the
  //                       camera and the phone's location work.
  //   In the desktop app  what File > EquipRite on your phone has set up, read from the local server (/__phone): the
  //                       VBCS address saved there, and this PC's Wi-Fi address while it lets a phone connect.
  // An address a phone cannot reach (this PC's localhost) is never offered.

  function str(v) { return v == null ? '' : String(v); }

  /** Whether a phone can open it: https, and not this PC's own name. */
  function reachable(url) {
    var m = /^https:\/\/([^/:?#]+)/i.exec(str(url));
    return !!m && !/^(localhost|127\.|\[::1\])/i.test(m[1]);
  }

  /** With from=qr, so the app offers to install itself when it opens (once). */
  function withQr(url) {
    var u = str(url);
    if (!u || /[?&]from=qr(&|$)/.test(u)) return u;
    return u + (u.indexOf('?') === -1 ? '?' : '&') + 'from=qr';
  }

  /**
   * The ways onto a phone, best first: [{ key: 'vbcs' | 'lan', label, url, note }].
   *   appUrls  $application.variables.appUrls; desktop: the local server's /__phone answer ({ vbcs, lan }), or null
   */
  function options(appUrls, desktop) {
    var out = [];
    var d = desktop || {};
    var vbcs = reachable(appUrls && appUrls.mobile) ? appUrls.mobile : (reachable(d.vbcs) ? d.vbcs : '');
    if (vbcs) {
      out.push({ key: 'vbcs', label: 'From VBCS', url: withQr(vbcs),
        note: 'Any phone, anywhere. It installs on the home screen, and the camera and location work.' });
    }
    if (/^http:\/\/\d{1,3}(\.\d{1,3}){3}:\d+\//.test(str(d.lan))) {
      out.push({ key: 'lan', label: 'This PC over Wi-Fi', url: str(d.lan),
        note: 'A phone on the same Wi-Fi, while EquipRite runs on this PC. The phone works as you.' });
    }
    return out;
  }

  /** The QR code for text as an image (an SVG data URL: sharp at any size). qrcode: resources/js/qrcode-generator. */
  function image(qrcode, text) {
    if (!text || typeof qrcode !== 'function') return '';
    var qr = qrcode(0, 'M');
    qr.addData(str(text), 'Byte');
    qr.make();
    var n = qr.getModuleCount();
    var q = 4;
    var t = n + q * 2;
    var d = '';
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (qr.isDark(r, c)) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
      }
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + t + ' ' + t + '" shape-rendering="crispEdges">'
      + '<rect width="' + t + '" height="' + t + '" fill="#fff"/><path fill="#000" d="' + d + '"/></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  return { reachable: reachable, withQr: withQr, options: options, image: image };
});
