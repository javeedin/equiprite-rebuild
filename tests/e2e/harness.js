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
 * @param {number}   o.port         Old EquipRite on this port, New on port + 1, Next on port + 2, Mobile on port + 3 (give each
 *                                  script its own)
 * @param {string}   [o.app]        'new' (default), 'next' or 'mobile': which app open() opens (mobile: a phone's viewport)
 * @param {Function} [o.handle]     (req, res) => answer, or undefined to fall through to the defaults.
 *                                  req: { method, path, query (URLSearchParams), body (string), json() }
 *                                  res: { json(obj, status), xml(text, status), bip(rows) }
 * @param {Object}   [o.access]     page code -> FULL | READ_ONLY | HIDDEN (default: every code FULL)
 * @param {string[]} [o.flags]      feature flags that are on (default: projects, timesheets, customers, agreements)
 * @param {Object}   [o.settings]   extra conf-global-settings { key: value }
 * @param {string}   [o.sessionRole] EQUIP_MGR (default), REQUESTOR, ADMIN, CUSTOMER …
 * @param {string}   [o.username]
 * @param {number}   [o.width]      viewport width (default 1440; 390 for mobile)
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
        bip: (rows) => res.xml(bipReport(rows)),
      };
      const r = { method: req.method, path: u.pathname, query: u.searchParams, body, json: () => (body ? JSON.parse(body) : null) };
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
        Object.entries(o.settings || {}).forEach(([k, v]) => rows.push({ settingKey: k, settingValue: String(v), isActiveFlag: 'Y' }));
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
  const overrides = { eqpt: fake, commonservice: fake, fusion: fake, bipservice: fake, callpwpbip: fake, ics: fake };
  const ports = { old: o.port, new: o.port + 1, next: o.port + 2, mobile: o.port + 3 };
  // Like the desktop app: Next and Mobile are listed when built (and then served, below).
  const built = (w) => DS.isBuilt(path.join(ROOT, 'build'), w);
  const versions = () => ({ old: `http://localhost:${ports.old}/`, new: `http://localhost:${ports.new}/`,
    next: built('equiprite-next') ? `http://localhost:${ports.next}/` : '', mobile: built('equiprite-mobile') ? `http://localhost:${ports.mobile}/` : '' });
  const serverLog = [];
  const common = { buildDir: path.join(ROOT, 'build'), getIdentity: () => identity, getVersions: versions, backendOverrides: overrides, onLog: (l) => serverLog.push(l) };
  const servers = [
    await DS.createDevServer(Object.assign({ webApp: 'vbredwoodapp', port: ports.old }, common)),
    await DS.createDevServer(Object.assign({ webApp: 'equiprite', port: ports.new }, common)),
  ];
  if (DS.isBuilt(path.join(ROOT, 'build'), 'equiprite-next')) {
    servers.push(await DS.createDevServer(Object.assign({ webApp: 'equiprite-next', port: ports.next }, common)));
  }
  if (DS.isBuilt(path.join(ROOT, 'build'), 'equiprite-mobile')) {
    servers.push(await DS.createDevServer(Object.assign({ webApp: 'equiprite-mobile', port: ports.mobile }, common)));
  }
  const app = o.app === 'next' || o.app === 'mobile' ? o.app : 'new';
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage(app === 'mobile'
    ? { viewport: { width: o.width || 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
    : { viewport: { width: o.width || 1440, height: 1000 } });
  // Mapbox: a geocoder answer for every lookup, and a minimal valid map style (a plain background) so a map can draw.
  await page.route('https://api.mapbox.com/**', (route) => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify(/\/styles\/v1\//.test(route.request().url())
      ? { version: 8, name: 'test', sources: {}, layers: [{ id: 'land', type: 'background', paint: { 'background-color': '#e8eef2' } }] }
      : { features: [{ center: [-102.37, 31.85], place_name: '1200 Pipeline Rd, Odessa, Texas 79761, United States' }] }) }));
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
    /**
     * Opens a path of the app under test and waits for its shell: New EquipRite ('/vp/shell/request/my-requests'), or
     * EquipRite Next ('/', '/?open=requests', '/?open=request&id=1'), or EquipRite Mobile ('/', '/?tab=track').
     */
    async open(p) {
      await page.goto(`http://localhost:${ports[app]}${p || '/'}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector({ next: '.nx-nav-item', mobile: '.mb-tabbtn', new: '.er-nav-item' }[app], { state: 'attached', timeout: 60000 });
      await page.waitForTimeout(1200);
    },
    /** Visible text of a selector, whitespace collapsed. */
    async text(sel) { return (await page.innerText(sel)).replace(/\s+/g, ' ').trim(); },
    async shot(name) { const f = path.join(out, name); await page.screenshot({ path: f, fullPage: true }); return f; },
    async close() {
      await browser.close();
      await Promise.all(servers.map((s) => s.close()));
      backend.close();
    },
  };
}

module.exports = { start, bipReport, ALL_CODES, ALL_FLAGS, ROOT };
