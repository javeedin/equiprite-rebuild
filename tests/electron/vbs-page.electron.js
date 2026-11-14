'use strict';
/**
 * desktop/lib/vbsPage.js in real Electron (run: xvfb-run -a npx electron --no-sandbox tests/electron/vbs-page.electron.js):
 * a stand-in VB Studio whose internal call (api2) answers only its own signed-in page — its session cookie, the bearer
 * token and CSRF header its page's own calls send — and its sign-in page otherwise. Not signed in: { signIn: true }.
 * Signed in: the call made from inside the hidden page answers data. Another site: refused.
 */
const http = require('http');
const path = require('path');
const { app, BrowserWindow, session } = require('electron');
const H = require('../_harness');
const P = require('../../desktop/lib/vbsPage');

const T = H.makeAsserter();
const PART = 'persist:vbspage-test-' + process.pid;
const seen = [];

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const cookie = String(req.headers.cookie || '');
  const signedIn = /(^|;\s*)sid=ok/.test(cookie);
  seen.push(u.pathname + ' ' + (req.headers.authorization || '-') + ' ' + (req.headers['x-csrf'] || '-'));
  if (u.pathname === '/acme-org/') {
    // not signed in: off to the sign-in host (another host name), which stays
    if (!signedIn) { res.writeHead(302, { Location: 'http://localhost:' + server.address().port + '/signin' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><title>Organization</title><body>VB Studio<script>fetch("/acme-org/api2/v2/organization/current", { headers: { Authorization: "Bearer TOKEN-1", "X-Csrf": "c1" } });</script>');
    return;
  }
  if (u.pathname === '/signin') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Sign In</title><form>user <input></form>'); return; }
  if (u.pathname.indexOf('/acme-org/api2/') === 0) {
    const ok = signedIn && req.headers.authorization === 'Bearer TOKEN-1' && req.headers['x-csrf'] === 'c1';
    if (!ok) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Sign In</title>'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(u.pathname.endsWith('/organization/projects') ? { items: [{ id: 'demo-agent_100001', name: 'Demo_Agent' }, { id: 'sample-git_100002', name: 'samplegit' }] } : { id: 'acme-org' }));
    return;
  }
  res.writeHead(404); res.end();
});

app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const logs = [];
  const make = () => P.create({ BrowserWindow: BrowserWindow, partition: PART, isHost: (h) => h === '127.0.0.1', log: (t) => logs.push(t), signInMs: 1200, quietMs: 3000, readyMs: 15000, idleMs: 5000 });
  try {
    T.section('not signed in (VB Studio sends its sign-in page, and it stays)');
    const p1 = make();
    const r1 = await p1.fetch(base + '/acme-org/api2/v2/organization/projects');
    T.check('said: sign in ({ signIn: true }); nothing asked of VB Studio\'s data', r1 && r1.signIn === true && !seen.some((x) => /organization\/projects/.test(x)), JSON.stringify(r1) + ' ' + logs.join(' | '));
    p1.close();

    T.section('signed in (the session kept from Open VB Studio): the call made from inside VB Studio\'s page');
    await session.fromPartition(PART).cookies.set({ url: base, name: 'sid', value: 'ok' });
    const p2 = make();
    const r2 = await p2.fetch(base + '/acme-org/api2/v2/organization/projects');
    const body = r2 && r2.ok ? JSON.parse(await r2.text()) : null;
    T.check('data: its projects — with its cookie, and the sign-in and X-… header VB Studio\'s own calls send', !!body && body.items.length === 2 && body.items[0].name === 'Demo_Agent' && r2.headers.get('content-type') === 'application/json'
      && seen.some((x) => x === '/acme-org/api2/v2/organization/projects Bearer TOKEN-1 c1'), JSON.stringify(body) + ' ' + seen.join(' | '));
    const r3 = await p2.fetch(base + '/acme-org/api2/v2/organization/current');
    T.check('…a second call: the same page (opened once here, once before signing in — not again)', r3.ok && seen.filter((x) => /^\/acme-org\/ /.test(x)).length === 2, seen.join(' | '));
    let threw = '';
    try { await p2.fetch('http://localhost:' + server.address().port + '/acme-org/api2/x'); } catch (e) { threw = e.message; }
    T.check('another site: refused', /Not VB Studio/.test(threw));
    T.check('the log says each step (opening, signed in)', logs.some((l) => /opening VB Studio's page <host>\/acme-org\//.test(l)) && logs.some((l) => /signed in: VB Studio's page is ready/.test(l)) && logs.some((l) => /not signed in/.test(l)), logs.join(' | '));
    p2.close();
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  }
  T.report();
  server.close();
  await session.fromPartition(PART).clearStorageData().catch(() => {});
  app.exit(T.state.fail ? 1 : 0);
});
app.on('window-all-closed', () => { /* kept until the tests end */ });
void path;
