'use strict';

/**
 * EquipRite on a phone, from the desktop app: the QR codes File > EquipRite on your phone shows, and the pairing that
 * lets a phone on the same Wi-Fi use EquipRite Mobile served by this PC. Plain Node, no shell (eScan-safe).
 *
 * Two ways onto a phone:
 *   VBCS       the deployed app's address (https): the phone opens it, installs it on the home screen, and the camera
 *              and its location work. The address is kept in this PC's user data, never in the project.
 *   This PC    EquipRite Mobile served on the PC's Wi-Fi address (http). Off until switched on; then on, with the
 *              same key, each time EquipRite starts, until switched off. The phone acts as the person signed in here,
 *              so only a phone that scanned the code may use it: the code carries a pairing key; switching it off,
 *              signing out or signing in as someone else ends it. An Android phone can open it in EquipRite for
 *              Android (android/), which this PC also serves: appIntent.
 */
const crypto = require('crypto');
const qrcode = require('./vendor/qrcode-generator');

const PAIR_COOKIE = 'eqp_pair';
// EquipRite for Android (android/), served to a paired phone by this PC.
const ANDROID_PACKAGE = 'com.equiprite.mobile';
const APK_PATH = '/__app/EquipRite.apk';
const PAIR_PARAM = 'pair';
// A phone keeps its pairing while the PC serves it (a home-screen icon keeps working); a new switch-on is a new key.
const PAIR_MAX_AGE_S = 30 * 24 * 3600;

/** True for a request from this PC itself. */
function isLoopback(addr) {
  const a = String(addr || '');
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' || a.startsWith('127.');
}

/** Whether an IPv4 address is a private network's (home or office Wi-Fi, a LAN). */
function isPrivate(a) {
  return /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
}

/**
 * The addresses a phone could reach this PC at: IPv4, not loopback, not link-local (169.254: no network), private
 * networks first. interfaces: os.networkInterfaces(). Returns [{ address, name }].
 */
function lanAddresses(interfaces) {
  const out = [];
  Object.keys(interfaces || {}).forEach((name) => {
    (interfaces[name] || []).forEach((i) => {
      const v4 = i && (i.family === 'IPv4' || i.family === 4);
      if (v4 && !i.internal && i.address && !/^169\.254\./.test(i.address)) out.push({ address: i.address, name });
    });
  });
  // Virtual adapters (WSL, Hyper-V, VirtualBox, Docker) are unreachable from a phone: last.
  const virtual = (n) => /vEthernet|WSL|Hyper-V|VirtualBox|VMware|docker|br-|veth/i.test(n);
  return out.sort((x, y) => (isPrivate(y.address) - isPrivate(x.address)) || (virtual(x.name) - virtual(y.name)));
}

/**
 * EquipRite Mobile's address on VBCS, from what was pasted: Mobile's own address, or any of the EquipRite web apps'
 * (…/webApps/equiprite-next/…, which becomes …/webApps/equiprite-mobile/). Returns { url } or { error }.
 */
function mobileUrlFromVbcs(text) {
  const raw = String(text || '').trim();
  if (!raw) return { error: 'Paste the address of EquipRite on VBCS.' };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: 'That is not a web address. It starts with https://' };
  }
  if (u.protocol !== 'https:') return { error: 'The VBCS address starts with https:// (a phone installs the app only from a secure address).' };
  const m = /^(.*\/webApps\/)[^/]+/.exec(u.pathname);
  if (!m) return { error: 'That address has no /webApps/ in it. Open EquipRite (Next or Mobile) on VBCS and copy the address from the browser.' };
  return { url: `${u.origin}${m[1]}equiprite-mobile/` };
}

/** A pairing key: random, URL-safe. */
function newToken() {
  return crypto.randomBytes(18).toString('base64url');
}

/** The address a phone opens: the PC's Wi-Fi address with the pairing key (and from=qr, so the app offers to install). */
function pairUrl(address, port, token) {
  return `http://${address}:${port}/?${PAIR_PARAM}=${encodeURIComponent(token)}&from=qr`;
}

/**
 * "Open in the EquipRite app" (Android): an intent link that hands the app the PC's address with its pairing key; a
 * phone without the app downloads it from the PC instead (browser_fallback_url).
 *   host  the Host the phone used (address:port); token  the pairing key now
 */
function appIntent(host, token) {
  const base = `http://${host}`;
  const open = `${base}/?${PAIR_PARAM}=${encodeURIComponent(token)}&from=app`;
  return `intent://open?url=${encodeURIComponent(open)}#Intent;scheme=equiprite;package=${ANDROID_PACKAGE};`
    + `S.browser_fallback_url=${encodeURIComponent(`${base}${APK_PATH}`)};end`;
}

/** With from=qr on an address, so the app offers to install itself when it opens. */
function fromQr(url) {
  return url + (url.indexOf('?') === -1 ? '?' : '&') + 'from=qr';
}

function same(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

function cookieOf(header, name) {
  const hit = String(header || '').split(/;\s*/).map((c) => c.split('=')).filter((p) => p[0] === name)[0];
  return hit ? decodeURIComponent(hit.slice(1).join('=')) : '';
}

/**
 * Whether a request from another device may be served: { ok, setCookie } or { ok: false }.
 *   token   the key now (null when the phone link is off: nobody else is served)
 *   query   the request's URLSearchParams; cookie: its Cookie header
 * The key comes with the QR code's address once; the phone keeps it as a cookie for the rest (the page's files, its
 * calls, a home-screen launch).
 */
function pairCheck(token, query, cookie) {
  if (!token) return { ok: false };
  const given = query && typeof query.get === 'function' ? query.get(PAIR_PARAM) : '';
  if (given && same(given, token)) {
    return { ok: true, setCookie: `${PAIR_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PAIR_MAX_AGE_S}` };
  }
  return { ok: same(cookieOf(cookie, PAIR_COOKIE), token) };
}

/** The page another device gets without the key. */
const NOT_PAIRED_HTML = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
  + '<title>EquipRite</title><body style="font:16px/1.5 system-ui,sans-serif;margin:32px;color:#16212c">'
  + '<h1 style="font-size:20px">Scan the code again</h1><p>This phone is not paired with EquipRite on the PC. On the PC, open '
  + '<b>File &gt; EquipRite on your phone</b>, switch on <b>From this PC</b> and scan the code with this phone.</p></body>';

/** The QR code for text, as an SVG (black on white, a quiet zone of 4 modules). */
function qrSvg(text, size) {
  const qr = qrcode(0, 'M');
  qr.addData(String(text), 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 4;
  const total = n + quiet * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  const px = size || 240;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${px}" height="${px}" shape-rendering="crispEdges"`
    + ` role="img" aria-label="QR code"><rect width="${total}" height="${total}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
}

/** The QR code's modules (for tests): rows of booleans, without the quiet zone. */
function qrMatrix(text) {
  const qr = qrcode(0, 'M');
  qr.addData(String(text), 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (__, c) => qr.isDark(r, c)));
}

module.exports = {
  isLoopback, isPrivate, lanAddresses, mobileUrlFromVbcs, newToken, pairUrl, fromQr, pairCheck, qrSvg, qrMatrix, appIntent,
  NOT_PAIRED_HTML, PAIR_COOKIE, PAIR_PARAM, ANDROID_PACKAGE, APK_PATH,
};
