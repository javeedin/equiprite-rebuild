/*
 * EquipRite on a phone, from the desktop app (desktop/lib/phone.js and the local server's pairing): the addresses a
 * phone can reach the PC at, EquipRite Mobile's VBCS address from what is pasted, the QR codes, and the pairing that
 * keeps every other device on the Wi-Fi out. The server is run for real; a request from another device is made
 * over this machine's own network address when it has one.
 *
 * Run:  node tests/desktop-phone.test.js
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const phone = require(path.join(ROOT, 'desktop', 'lib', 'phone.js'));
const DS = require(path.join(ROOT, 'desktop', 'lib', 'devserver.js'));

T.section('the addresses a phone can reach the PC at');
const nets = {
  lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
  'vEthernet (WSL)': [{ family: 'IPv4', address: '172.22.80.1', internal: false }],
  'Wi-Fi': [{ family: 'IPv4', address: '192.168.1.23', internal: false }, { family: 'IPv6', address: 'fe80::1', internal: false }],
  Ethernet: [{ family: 'IPv4', address: '169.254.10.2', internal: false }],
  Public: [{ family: 4, address: '81.2.69.160', internal: false }],
};
T.eq('the Wi-Fi first; virtual adapters after; no loopback, no 169.254, no IPv6', phone.lanAddresses(nets).map((a) => a.address).join(), '192.168.1.23,172.22.80.1,81.2.69.160');
T.eq('no network: none', phone.lanAddresses({ lo: nets.lo }).length, 0);
T.check('loopback is this PC', ['127.0.0.1', '::1', '::ffff:127.0.0.1'].every(phone.isLoopback) && !phone.isLoopback('192.168.1.5'));

T.section('EquipRite Mobile on VBCS, from a pasted address');
const base = 'https://eqp-abc.builder.us-ashburn-1.ocp.oraclecloud.com/ic/builder/rt/EquipRite_Rebuild/live/webApps/';
T.eq('Next\'s address becomes Mobile\'s', phone.mobileUrlFromVbcs(base + 'equiprite-next/?open=requests').url, base + 'equiprite-mobile/');
T.eq('Mobile\'s own', phone.mobileUrlFromVbcs(base + 'equiprite-mobile').url, base + 'equiprite-mobile/');
T.eq('Old\'s deep page', phone.mobileUrlFromVbcs(base + 'vbredwoodapp/vp/shell/home').url, base + 'equiprite-mobile/');
T.check('http is refused (a phone installs only from a secure address)', /https/.test(phone.mobileUrlFromVbcs('http://x.com/webApps/a/').error));
T.check('not an address', !!phone.mobileUrlFromVbcs('equiprite').error);
T.check('no /webApps/ in it', /webApps/.test(phone.mobileUrlFromVbcs('https://x.com/ic/home').error));
T.eq('from=qr added, so the app offers to install', phone.fromQr(base + 'equiprite-mobile/'), base + 'equiprite-mobile/?from=qr');

T.section('the QR codes');
const url = phone.pairUrl('192.168.1.23', 18898, 'k3y');
T.eq('the Wi-Fi address carries the key and from=qr', url, 'http://192.168.1.23:18898/?pair=k3y&from=qr');
const m = phone.qrMatrix(url);
T.check('a square code, version 3 or more (29+ modules)', m.length >= 29 && m.every((r) => r.length === m.length));
const finder = (r0, c0) => [0, 6].every((i) => [0, 1, 2, 3, 4, 5, 6].every((j) => m[r0 + i][c0 + j] && m[r0 + j][c0 + i]));
T.check('the three finder patterns', finder(0, 0) && finder(0, m.length - 7) && finder(m.length - 7, 0));
const svg = phone.qrSvg(url, 256);
const n = m.length + 8;
T.check('an SVG with a quiet zone', svg.startsWith('<svg') && svg.indexOf(`viewBox="0 0 ${n} ${n}"`) !== -1 && /width="256"/.test(svg));
const drawn = (svg.match(/M(\d+) (\d+)h1v1h-1z/g) || []).map((s) => s.match(/\d+/g).map(Number));
const dark = m.reduce((s, r) => s + r.filter(Boolean).length, 0);
T.eq('every dark module drawn, once', drawn.length, dark);
T.check('in the right places', drawn.every(([x, y]) => m[y - 4][x - 4]));
T.check('a long address still fits', phone.qrMatrix('https://' + 'a'.repeat(200) + '.com/webApps/equiprite-mobile/?from=qr').length > 29);

T.section('pairing: only a phone that scanned the code');
const t1 = phone.newToken();
T.check('keys are random and URL-safe', t1 !== phone.newToken() && /^[A-Za-z0-9_-]{20,}$/.test(t1));
const q = (s) => new URLSearchParams(s);
T.eq('switched off: nobody', phone.pairCheck(null, q('pair=' + t1), '').ok, false);
const first = phone.pairCheck(t1, q('pair=' + t1), '');
T.check('the code\'s key: in, and kept as a cookie (HttpOnly)', first.ok && /^eqp_pair=/.test(first.setCookie) && /HttpOnly/.test(first.setCookie));
T.eq('then the cookie is enough', phone.pairCheck(t1, q(''), 'a=1; eqp_pair=' + t1).ok, true);
T.eq('a wrong key: out', phone.pairCheck(t1, q('pair=nope'), '').ok, false);
T.eq('an old cookie after switching on again: out', phone.pairCheck(phone.newToken(), q(''), 'eqp_pair=' + t1).ok, false);
T.eq('nothing: out', phone.pairCheck(t1, q(''), '').ok, false);

/** A throwaway build folder with EquipRite Mobile in it. */
function build2() {
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-phone2-'));
  fs.mkdirSync(path.join(b, 'processed', 'webApps', 'equiprite-mobile'), { recursive: true });
  fs.mkdirSync(path.join(b, 'processed', 'services'), { recursive: true });
  fs.writeFileSync(path.join(b, 'processed', 'webApps', 'equiprite-mobile', 'index.html'), '<html>mobile</html>');
  fs.writeFileSync(path.join(b, 'processed', 'services', 'catalog.json'), '{"backends":{}}');
  return b;
}

function get(host, port, p, headers) {
  return new Promise((resolve) => {
    http.get({ host, port, path: p, headers: headers || {} }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b, cookie: res.headers['set-cookie'] || [] }));
    }).on('error', (e) => resolve({ status: 0, body: e.message, cookie: [] }));
  });
}

(async () => {
  T.section('the local server, open to a paired phone');
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-phone-'));
  const web = path.join(build, 'processed', 'webApps', 'equiprite-mobile');
  fs.mkdirSync(web, { recursive: true });
  fs.mkdirSync(path.join(build, 'processed', 'services'), { recursive: true });
  fs.writeFileSync(path.join(web, 'index.html'), '<html>mobile</html>');
  fs.writeFileSync(path.join(build, 'processed', 'services', 'catalog.json'), JSON.stringify(H.readJson(path.join(H.SERVICES, 'catalog.json'))));
  let token = phone.newToken();
  const srv = await DS.createDevServer({
    buildDir: build, repoRoot: ROOT, port: 0, webApp: 'equiprite-mobile', host: '0.0.0.0', pairToken: () => token,
    getIdentity: () => ({ username: 'john.dunbar', roles: ['RT_EQP_MANAGER'] }), getVersions: () => ({}),
  });
  try {
    T.eq('this PC is served as before', (await get('127.0.0.1', srv.port, '/')).body, '<html>mobile</html>');
    T.eq('…its web services page too', (await get('127.0.0.1', srv.port, '/__services/')).status, 200);
    const lan = phone.lanAddresses(os.networkInterfaces())[0];
    if (!lan) {
      T.check('(no network address on this machine: another device cannot be tried here)', true);
    } else {
      const other = (p, h) => get(lan.address, srv.port, p, h);
      const no = await other('/');
      T.check('another device without the key: refused, told to scan the code', no.status === 403 && /Scan the code again/.test(no.body));
      T.eq('…and gets no user', (await other('/_currentuser')).status, 403);
      const yes = await other('/?pair=' + encodeURIComponent(token) + '&from=qr');
      T.check('with the code\'s key: the app, and the key kept as a cookie', yes.status === 200 && yes.body === '<html>mobile</html>' && /eqp_pair=/.test(yes.cookie.join()));
      const cookie = { cookie: yes.cookie[0].split(';')[0] };
      T.eq('then its calls go through with the cookie', JSON.parse((await other('/_currentuser', cookie)).body).userName, 'john.dunbar');
      T.eq('never the web services page', (await other('/__services/', cookie)).status, 404);
      token = null;
      T.eq('switched off: the paired phone is out too', (await other('/_currentuser', cookie)).status, 403);
      T.eq('this PC still is', (await get('127.0.0.1', srv.port, '/')).status, 200);
    }
  } catch (e) {
    T.check('server run', false, e.stack);
  } finally {
    await srv.close();
    fs.rmSync(build, { recursive: true, force: true });
  }

  T.section('the phone\'s addresses, for Next\'s toolbar (/__phone)');
  const srv2 = await DS.createDevServer({
    buildDir: build2(), repoRoot: ROOT, port: 0, webApp: 'equiprite-mobile', getIdentity: () => ({ username: 'x' }),
    getPhone: () => ({ vbcs: 'https://h/webApps/equiprite-mobile/?from=qr', lan: '' }),
  });
  try {
    T.eq('this PC gets them', JSON.parse((await get('127.0.0.1', srv2.port, '/__phone')).body).vbcs, 'https://h/webApps/equiprite-mobile/?from=qr');
    T.eq('not by another name (a page on another site rebinding its name to this PC)', (await get('127.0.0.1', srv2.port, '/__phone', { host: 'evil.example:80' })).status, 404);
  } finally {
    await srv2.close();
  }

  T.section('the desktop app');
  const main = fs.readFileSync(path.join(ROOT, 'desktop', 'main.js'), 'utf8');
  T.check('File > EquipRite on your phone (QR code)', /EquipRite on your phone \(QR code\)/.test(main));
  T.check('the Wi-Fi server listens on the network only with the pairing key', /host: '0\.0\.0\.0',\s*pairToken: \(\) => lan\.token/.test(main));
  T.check('it stops on sign-out, on a new sign-in and on quit', (main.match(/stopLan\(\);/g) || []).length >= 3);
  T.check('the window only talks to its own preload', /fromPhone\(event\)/.test(main) && fs.existsSync(path.join(ROOT, 'desktop', 'phone-preload.js')));
  const html = fs.readFileSync(path.join(ROOT, 'desktop', 'phone.html'), 'utf8');
  T.check('the window\'s page runs only its own script', /script-src 'self'/.test(html) && /<script src="phone-window\.js"><\/script>/.test(html));
  T.report();
})();
