'use strict';
/*
 * Browser runs of New EquipRite against a stand-in backend.
 *
 * Starts both apps from build/processed (run `npm run build` first) on local servers, points every backend
 * (eqpt, commonService, Fusion REST, BI Publisher, ICS) at one fake HTTP server, opens Chromium with Playwright
 * and records what the app sends. A script supplies only the answers its screen needs (`handle`); settings,
 * session roles, page access and Mapbox have defaults.
 *
 *   const E = require('./harness');
 *   const env = await E.start({ port: 19100, handle: (req, res) => {
 *     if (req.path.endsWith('/views/workbench')) return res.json({ data: [...] });
 *   } });
 *   await env.open('/vp/shell/fulfil/workbench');
 *   ...
 *   env.writes     // [{ method, path, query, body }] every non-GET call
 *   env.calls      // ['GET /equiprite/v1/...?...'] every call
 *   env.errors     // browser console errors and warnings (VB's routine warnings left out)
 *   await env.shot('workbench.png')
 *   await env.close()
 *
 * Not part of `npm test` (needs a build and Chromium): run with `node tests/e2e/<file>.e2e.js`.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const DS = require(path.join(ROOT, 'desktop', 'lib', 'devserver.js'));

const ALL_CODES = ['EQR_DASHBOARD', 'EQR_WORKBENCH', 'EQR_PROJ_CREATE_REQUEST', 'EQR_EQUIPMENT_REQUESTS', 'EQR_EQUIPMENT_SCHEDULE',
  'EQR_EQUIPMENT_MASTER', 'EQR_INITIATE_PICKING', 'EQR_EQUIPMENT_RETURNS', 'EQR_RATE_SCHEDULE', 'EQR_TIMESHEETS',
  'EQR_TIMESHEET_APPROVALS', 'EQR_POST_COST', 'EQR_RENTAL_AGREEMENTS', 'EQR_ANALYTICS', 'EQR_REPORTS', 'EQR_CONFIGURATIONS',
  'EQR_RBAC_ADMIN', 'EQR_CUST_DASHBOARD', 'EQR_CUST_MY_REQUESTS', 'EQR_CUST_CREATE_REQ'];
const ALL_FLAGS = ['PROJECTS_MODULE_ENABLED', 'TIMESHEETS_ENABLED', 'CUSTOMERS_MODULE_ENABLED', 'AGREEMENTS_ENABLED'];
const QUIET = /not fully qualified|Skip URL mapping/;

/** A BI Publisher runReport SOAP answer whose report holds `rows` (each a { TAG: value } object) as G_1 rows. */
function bipReport(rows) {
  const xml = '<DATA_DS>' + rows.map((r) => '<G_1>' + Object.entries(r).map(([k, v]) => `<${k}>${v}</${k}>`).join('') + '</G_1>').join('') + '</DATA_DS>';
  return '<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>'
    + '<ns2:runReportResponse><ns2:runReportReturn><ns2:reportBytes>' + Buffer.from(xml).toString('base64')
    + '</ns2:reportBytes></ns2:runReportReturn></ns2:runReportResponse></soap:Body></soap:Envelope>';
}

/**
 * @param {Object}   o
 * @param {number}   o.port         Old EquipRite on this port, New on port + 1, Next on port + 2, Mobile on port + 3, Future on
 *                                  port + 4 (give each script its own)
 * @param {string}   [o.app]        'new' (default), 'next', 'mobile', 'future' or 'old': which app open() opens (mobile: a phone's
 *                                  viewport). Future calls no backend: its data is simulated in the browser
 * @param {Function} [o.handle]     (req, res) => answer, or undefined to fall through to the defaults.
 *                                  req: { method, path, query (URLSearchParams), body (string), json(), headers }
 *                                  res: { json(obj, status), xml(text, status), bip(rows) }
 * @param {Object}   [o.access]     page code -> FULL | READ_ONLY | HIDDEN (default: every code FULL)
 * @param {string[]} [o.flags]      feature flags that are on (default: projects, timesheets, customers, agreements)
 * @param {Object}   [o.settings]   extra conf-global-settings { key: value }
 * @param {string}   [o.sessionRole] EQUIP_MGR (default), REQUESTOR, ADMIN, CUSTOMER …
 * @param {string}   [o.username]
 * @param {number}   [o.width]      viewport width (default 1440; 390 for mobile)
 * @param {boolean}  [o.phoneApp]   EquipRite Mobile's server as the desktop app's Wi-Fi link: it serves EquipRite for Android
 *                                  (desktop/phone-app/EquipRite.apk) at /__app/…, with the pairing key 'test-pair-key'
 * @param {string}   [o.userAgent]  the browser's user agent (an Android phone, or EquipRite for Android)
 * @param {Function} [o.init]       run in the page before the app (addInitScript), e.g. to stand in for window.EquipRiteApp
 * @param {Object}   [o.desktop]    as inside the desktop app: { phone: what /__phone answers } (window.erpDesktop.openPhone
 *                                  counts its calls in window.__openedPhone)
 * @param {Object}   [o.jiraStore]  Connect Jira as in the desktop app (desktop/lib/jiraAuth.js open()): Old and Next's servers then
 *                                  answers /__jira/* and adds the saved email and token to its jira backend calls. Every app's
 *                                  jira backend is the fake server (its calls arrive at the Jira path, /rest/api/2/…)
 * @param {Object}   [o.recStore]   Record on a Jira story, as in the desktop app (desktop/lib/testEvidence.js open()): Old and
 *                                  Next's servers then answer /__rec/* (the page still needs window.erpDesktop's record calls)
 */
async function start(o) {
  const calls = [];
  const writes = [];
  const access = o.access || Object.fromEntries(ALL_CODES.map((c) => [c, 'FULL']));
  const flags = o.flags || ALL_FLAGS;
  const backend = http.createServer((req, raw) => {
    const u = new URL(req.url, 'http://x');
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push(`${req.method} ${u.pathname}${u.search}`);
      const res = {
        json: (b, s) => { raw.writeHead(s || 200, { 'content-type': 'application/json' }); raw.end(JSON.stringify(b)); return true; },
        xml: (t, s) => { raw.writeHead(s || 200, { 'content-type': 'text/xml' }); raw.end(t); return true; },
        bytes: (buf, type) => { raw.writeHead(200, { 'content-type': type || 'application/octet-stream' }); raw.end(buf); return true; },
        bip: (rows) => res.xml(bipReport(rows)),
      };
      const r = { method: req.method, path: u.pathname, query: u.searchParams, body, json: () => (body ? JSON.parse(body) : null),
        headers: req.headers, auth: req.headers.authorization || '' };
      if (req.method !== 'GET') {
        let parsed = body;
        try { parsed = body ? JSON.parse(body) : null; } catch (e) { /* SOAP and other text bodies stay text */ }
        if (!u.pathname.endsWith('/ExternalReportWSSService')) {
          writes.push({ method: req.method, path: u.pathname, query: u.search, body: parsed });
        }
      }
      if (o.handle && o.handle(r, res)) return;
      const p = u.pathname;
      if (p.endsWith('/conf-global-settings')) {
        const rows = flags.map((k) => ({ settingKey: k, settingValue: 'true', settingCategory: 'FEATURE_FLAG', isActiveFlag: 'Y' }));
        // SYSTEM: the category the apps' loadFeatureFlagsChain reads settings from (without it they were dropped).
        Object.entries(o.settings || {}).forEach(([k, v]) => rows.push({ settingKey: k, settingValue: String(v), settingCategory: 'SYSTEM', isActiveFlag: 'Y' }));
        return res.json({ data: rows });
      }
      if (p.endsWith('/rbac/session-roles')) return res.json({ data: [{ sessionRole: o.sessionRole || 'EQUIP_MGR', priority: 40 }] });
      if (p.endsWith('/rbac/page-access')) return res.json({ data: access });
      if (p.endsWith('/ExternalReportWSSService')) return res.bip([]);
      if (req.method === 'POST') return res.json({ id: 1 }, 201);
      return res.json({ data: [] });
    });
  });
  await new Promise((r) => backend.listen(0, '127.0.0.1', r));
  const fake = `http://127.0.0.1:${backend.address().port}`;
  const identity = { username: o.username || 'priya.raman', roles: ['RT_EQP_MANAGER'], fusion: null };
  // jira too: a test never reaches the real Jira (its calls land on the fake backend at /rest/api/2/…).
  const overrides = { eqpt: fake, commonservice: fake, fusion: fake, bipservice: fake, callpwpbip: fake, ics: fake, jira: fake };
  const ports = { old: o.port, new: o.port + 1, next: o.port + 2, mobile: o.port + 3, future: o.port + 4 };
  // Like the desktop app: Next, Mobile and Future are listed when built (and then served, below).
  const built = (w) => DS.isBuilt(path.join(ROOT, 'build'), w);
  const versions = () => ({ old: `http://localhost:${ports.old}/`, new: `http://localhost:${ports.new}/`,
    next: built('equiprite-next') ? `http://localhost:${ports.next}/` : '', mobile: built('equiprite-mobile') ? `http://localhost:${ports.mobile}/` : '',
    future: built('equiprite-future') ? `http://localhost:${ports.future}/` : '' });
  const serverLog = [];
  const common = { buildDir: path.join(ROOT, 'build'), getIdentity: () => identity, getVersions: versions, backendOverrides: overrides, onLog: (l) => serverLog.push(l),
    getPhone: () => (o.desktop && o.desktop.phone) || {} };
  const servers = [
    await DS.createDevServer(Object.assign({ webApp: 'vbredwoodapp', port: ports.old }, common, o.jiraStore ? { jiraStore: o.jiraStore } : {},
      o.recStore ? { recStore: o.recStore } : {}, o.transcribe ? { transcribe: o.transcribe } : {})),
    await DS.createDevServer(Object.assign({ webApp: 'equiprite', port: ports.new }, common)),
  ];
  if (DS.isBuilt(path.join(ROOT, 'build'), 'equiprite-next')) {
    // o.sqlStore: the SQL worksheet's store (desktop/lib/oracleSql.js, with a fake driver in tests).
    // o.jiraStore: Connect Jira's store (desktop/lib/jiraAuth.js), as the desktop app gives Old and Next.
    servers.push(await DS.createDevServer(Object.assign({ webApp: 'equiprite-next', port: ports.next }, common, o.sqlStore ? { sqlStore: o.sqlStore } : {}, o.aiStore ? { aiStore: o.aiStore } : {},
      o.jiraStore ? { jiraStore: o.jiraStore } : {}, o.recStore ? { recStore: o.recStore } : {}, o.transcribe ? { transcribe: o.transcribe } : {}, o.minutesStore ? { minutesStore: o.minutesStore } : {},
      o.followupsStore ? { followupsStore: o.followupsStore } : {}, o.fddStore ? { fddStore: o.fddStore } : {}, o.analysisStore ? { analysisStore: o.analysisStore } : {}, o.pagesStore ? { pagesStore: o.pagesStore } : {})));
  }
  let futureStore = null;
  if (DS.isBuilt(path.join(ROOT, 'build'), 'equiprite-future')) {
    // o.futureDb: a DuckDB file for Future's story (as the desktop app keeps it); without it the story lives in the browser only.
    futureStore = o.futureDb ? await require('../../desktop/lib/futureDb').open(o.futureDb) : null;
    servers.push(await DS.createDevServer(Object.assign({ webApp: 'equiprite-future', port: ports.future }, common, futureStore ? { futureStore } : {})));
  }
  if (DS.isBuilt(path.join(ROOT, 'build'), 'equiprite-mobile')) {
    servers.push(await DS.createDevServer(Object.assign({ webApp: 'equiprite-mobile', port: ports.mobile }, common, o.phoneApp ? {
      phoneApp: { apkFile: path.join(ROOT, 'desktop', 'phone-app', 'EquipRite.apk'),
        version: JSON.parse(fs.readFileSync(path.join(ROOT, 'desktop', 'phone-app', 'version.json'), 'utf8')).versionName }, pairToken: () => 'test-pair-key' } : {})));
  }
  const app = ['next', 'mobile', 'future', 'old'].indexOf(o.app) !== -1 ? o.app : 'new';
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage(app === 'mobile'
    ? Object.assign({ viewport: { width: o.width || 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, o.userAgent ? { userAgent: o.userAgent } : {})
    : { viewport: { width: o.width || 1440, height: 1000 } });
  if (typeof o.init === 'function') await page.addInitScript(o.init);
  // Mapbox: a geocoder answer for every lookup, and a minimal valid map style (a plain background) so a map can draw.
  await page.route('https://api.mapbox.com/**', (route) => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify(/\/styles\/v1\//.test(route.request().url())
      ? { version: 8, name: 'test', sources: {}, layers: [{ id: 'land', type: 'background', paint: { 'background-color': '#e8eef2' } }] }
      : { features: [{ center: [-102.37, 31.85], place_name: '1200 Pipeline Rd, Odessa, Texas 79761, United States' }] }) }));
  if (o.desktop) {
    await page.addInitScript(() => {
      window.erpDesktop = { isDesktop: true, app: 'equiprite', openPhone: () => { window.__openedPhone = (window.__openedPhone || 0) + 1; return Promise.resolve(true); } };
    });
  }
  const errors = [];
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !QUIET.test(m.text())) errors.push(`${m.type()}: ${m.text()}`.slice(0, 400)); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 400)));
  const out = o.shots || path.join(require('os').tmpdir(), 'equiprite-e2e');
  fs.mkdirSync(out, { recursive: true });

  return {
    page, calls, writes, errors, serverLog,
    newUrl: `http://localhost:${ports.new}`,
    oldUrl: `http://localhost:${ports.old}`,
    nextUrl: `http://localhost:${ports.next}`,
    mobileUrl: `http://localhost:${ports.mobile}`,
    futureUrl: `http://localhost:${ports.future}`,
    /** What /__versions answers here (the desktop app's list): { old, new, next, mobile, future }. */
    versions,
    /**
     * Opens a path of the app under test and waits for its shell: New EquipRite ('/vp/shell/request/my-requests'), or
     * EquipRite Next ('/', '/?open=requests', '/?open=request&id=1'), EquipRite Mobile ('/', '/?tab=track'), EquipRite
     * Future ('/', '/?open=guide', '/?open=request&id=R1001'), or Old EquipRite ('/vp/shell/setup/jira-stories').
     */
    async open(p) {
      await page.goto(`http://localhost:${ports[app]}${p || '/'}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector({ next: '.nx-nav-item', future: '.nx-nav-item', mobile: '.mb-tabbtn', new: '.er-nav-item', old: '#vbRouterContent' }[app], { state: 'attached', timeout: 60000 });
      await page.waitForTimeout(1200);
    },
    /**
     * EquipRite Next: chooses the look in your menu, as a user does ('redwood' or 'current'), and waits until every screen
     * shows it (html[data-nx-look]). The choice is kept for the user, so a reload keeps it.
     */
    async setLook(look) {
      await page.click('#nxUser');
      await page.waitForSelector('#nxLook-' + look, { timeout: 15000 });
      await page.click('#nxLook-' + look);
      await page.waitForFunction((l) => document.documentElement.getAttribute('data-nx-look') === l, look, { timeout: 10000 });
      await page.keyboard.press('Escape');
      await page.waitForSelector('#nxProfilePanel', { state: 'detached', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
    },
    /** Visible text of a selector, whitespace collapsed. */
    async text(sel) { return (await page.innerText(sel)).replace(/\s+/g, ' ').trim(); },
    async shot(name) { const f = path.join(out, name); await page.screenshot({ path: f, fullPage: true }); return f; },
    async close() {
      await browser.close();
      await Promise.all(servers.map((s) => s.close()));
      if (futureStore) await futureStore.close();
      backend.close();
    },
  };
}

// Record on a Jira story, as in the desktop app (pass as o.init, with o.recStore): window.erpDesktop's record calls
// (desktop/preload.js; each logged in window.__rec, the shortcut handler kept in window.__recKey) and the screen, a canvas
// that keeps changing, handed out as getDisplayMedia would (Electron answers it in desktop/main.js).
function recorderStub() {
  window.__rec = [];
  window.erpDesktop = {
    recordSources: () => Promise.resolve([{ id: 'window:42:0', name: 'Fusion - Oracle Applications', kind: 'window', thumb: '' },
      { id: 'screen:1:0', name: 'Entire screen', kind: 'screen', thumb: '' }]),
    recordUse: (id) => { window.__rec.push('use ' + id); return Promise.resolve(true); },
    recordState: (on) => { window.__rec.push('state ' + on); return Promise.resolve({ shot: 'Ctrl+Alt+S', stop: 'Ctrl+Alt+X' }); },
    recordWindow: (what) => { window.__rec.push('window ' + what); return Promise.resolve(true); },
    onRecordKey: (cb) => { window.__recKey = cb; },
  };
  const md = navigator.mediaDevices || {};
  md.getDisplayMedia = () => {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    let n = 0;
    const paint = () => { n++; g.fillStyle = 'hsl(' + (n * 7 % 360) + ',70%,50%)'; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText('Testing · ' + n, 40, 180); };
    paint();
    const timer = setInterval(paint, 66);
    const stream = c.captureStream(15);
    stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(timer));
    window.__shared = (window.__shared || 0) + 1;
    return Promise.resolve(stream);
  };
  // Record my voice: a microphone, stubbed as a silent audio track (a muted oscillator), so the recording has audio.
  md.getUserMedia = (c) => {
    window.__micCalls = (window.__micCalls || 0) + 1;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const dest = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;                 // silent: a track, not a noise
      osc.connect(gain).connect(dest);
      osc.start();
      return Promise.resolve(dest.stream);
    } catch (e) {
      return Promise.resolve(new MediaStream());
    }
  };
}

/**
 * A throwaway project for the FDD library (desktop/lib/fdd.js), to pass as o.fddStore: uploads go into it (and, as in the
 * desktop app, into the build's copy of resources/fdd, which restore() puts back). With { git: true } it is a git
 * repository on branch fdd/test whose origin is a bare repository beside it, so Commit & push really pushes.
 *
 *   const fdd = await fddSandbox({ git: true });  →  { root, remote, store, git(args…), restore() }
 */
async function fddSandbox(opts) {
  const o = opts || {};
  const os = require('os');
  const { execFileSync } = require('child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-fdd-e2e-'));
  fs.mkdirSync(path.join(root, 'webApps', 'equiprite-next', 'resources', 'fdd'), { recursive: true });
  // its own (empty) library, so the app shows this project's, whatever FDDs the real project holds
  fs.writeFileSync(path.join(root, 'webApps', 'equiprite-next', 'resources', 'fdd', 'library.json'), JSON.stringify({ latest: '', docs: [] }, null, 2) + '\n');
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let remote = '';
  if (o.git) {
    remote = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-fdd-e2e-remote-'));
    git(remote, 'init', '--bare', '-q');
    git(root, 'init', '-q', '-b', 'fdd/test');
    git(root, 'config', 'user.email', 'test@example.com'); git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(root, 'webApps', 'equiprite-next', 'app.txt'), 'app\n');
    git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'start');
    git(root, 'remote', 'add', 'origin', remote); git(root, 'push', '-q', '-u', 'origin', 'fdd/test');
  }
  const store = require(path.join(ROOT, 'desktop', 'lib', 'fdd.js')).open({ root });
  // the build's copy, as it is now, to put back afterwards
  const web = path.join(ROOT, 'build', 'processed', 'webApps', 'equiprite-next');
  const ver = fs.existsSync(web) ? fs.readdirSync(web).filter((n) => /^version_/.test(n)).sort().pop() : '';
  const res = ver ? path.join(web, ver, 'resources', 'fdd') : '';
  const saved = {};
  if (res && fs.existsSync(res)) fs.readdirSync(res).forEach((f) => { saved[f] = fs.readFileSync(path.join(res, f)); });
  function restore() {
    if (res && fs.existsSync(res)) {
      fs.readdirSync(res).forEach((f) => { if (!saved[f]) fs.unlinkSync(path.join(res, f)); });
      Object.keys(saved).forEach((f) => fs.writeFileSync(path.join(res, f), saved[f]));
    }
    [root, remote].filter(Boolean).forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* tmp */ } });
  }
  return { root, remote, store, git: (...args) => git(root, ...args), gitRemote: (...args) => git(remote, ...args), restore };
}

/**
 * A throwaway copy of the project's code (webApps' JSON/HTML/JS and services/) for the Application pages catalog
 * (desktop/lib/pages.js), to pass as o.pagesStore: a git repository on branch pages/test whose origin is a bare one beside
 * it, so Commit & push really pushes. Its catalog is also written into the build's copy of resources/pages (as in the
 * desktop app), which restore() puts back. `capture` stands in for the desktop app's hidden-window screenshot.
 *
 *   const pg = await pagesSandbox({ capture });  →  { root, remote, store, gitRemote(args…), restore() }
 */
async function pagesSandbox(opts) {
  const o = opts || {};
  const os = require('os');
  const { execFileSync } = require('child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-pages-e2e-'));
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-pages-e2e-remote-'));
  fs.cpSync(path.join(ROOT, 'webApps'), path.join(root, 'webApps'), { recursive: true,
    filter: (src) => { try { return fs.statSync(src).isDirectory() || /\.(json|html|js)$/.test(src); } catch (e) { return false; } } });
  fs.cpSync(path.join(ROOT, 'services'), path.join(root, 'services'), { recursive: true });
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(remote, 'init', '--bare', '-q');
  git(root, 'init', '-q', '-b', 'pages/test'); git(root, 'config', 'user.email', 'test@example.com'); git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'commit.gpgsign', 'false');
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'start'); git(root, 'remote', 'add', 'origin', remote); git(root, 'push', '-q', '-u', 'origin', 'pages/test');
  const store = require(path.join(ROOT, 'desktop', 'lib', 'pages.js')).open({ root, capture: o.capture });
  // the build's copy of resources/pages, as it is now, to put back afterwards
  const web = path.join(ROOT, 'build', 'processed', 'webApps', 'equiprite-next');
  const ver = fs.existsSync(web) ? fs.readdirSync(web).filter((n) => /^version_/.test(n)).sort().pop() : '';
  const res = ver ? path.join(web, ver, 'resources', 'pages') : '';
  const saved = res && fs.existsSync(res) ? fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-pages-build-')) : '';
  if (saved) fs.cpSync(res, saved, { recursive: true });
  function restore() {
    if (res) { try { fs.rmSync(res, { recursive: true, force: true }); if (saved) fs.cpSync(saved, res, { recursive: true }); } catch (e) { /* the next build puts it back */ } }
    [root, remote, saved].filter(Boolean).forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* tmp */ } });
  }
  return { root, remote, store, gitRemote: (...args) => git(remote, ...args), restore };
}

module.exports = { start, bipReport, recorderStub, fddSandbox, pagesSandbox, ALL_CODES, ALL_FLAGS, ROOT };
