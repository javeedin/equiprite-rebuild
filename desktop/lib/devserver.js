'use strict';

/**
 * EquipRite's local server: serves the built app and does the server-side jobs Visual Builder does for it when
 * deployed, so the app runs on a laptop against the live backends.
 *
 * Oracle's own `grunt vb-serve` is only express.static plus a canned /_currentuser. Under VBCS the server also
 *   1. fills the %{env.…}% placeholders the build leaves in app-flow.json, among them the URL VB reads the
 *      signed-in user from (left as-is, VB fetches "/%{env.userProfileUrl}%", gets a 404 and has no user);
 *   2. serves the application's services/catalog.json next to the web app (the build writes it to
 *      build/processed/services/, so locally VB configured no REST endpoint at all);
 *   3. proxies every "forceProxy" / authenticated backend, adding the stored credential.
 * This does the same:
 *   /_currentuser                    the local identity (isAnonymous: false, userName, …)
 *   <version>/app-flow.json          userProfileUrl placeholder -> /_currentuser
 *   <version>/services/catalog.json  each backend's server -> /__backend/<name> on this server, with forceProxy and
 *                                    the VBCS credential reference removed, so VB calls it directly (same origin)
 *   /__backend/<name>/…              forwarded to the backend's real URL; backends that use the Fusion credential
 *                                    get the local Fusion login as basic auth
 *   /__services/                     the web services page (desktop/web-services.html): every endpoint of every
 *                                    service connection, with a GET tester that calls through /__backend
 *
 * Roles come from the ROLES_RP BI Publisher report (loadFusionRolesChain). With identity.roles set, that one report
 * is answered here with those roles, in the shape Fusion returns, so a persona can be used without a Fusion login.
 *
 * Plain Node, no dependencies, no shell (eScan-safe). The desktop shell runs it in-process; `npm run serve` runs it
 * standalone (see the bottom of this file).
 */
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const TT = require('./testTrace');
const { buildCatalog } = require('./catalog');
const { isLoopback, pairCheck, appIntent, NOT_PAIRED_HTML, APK_PATH } = require('./phone');

const DESKTOP_DIR = path.join(__dirname, '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer'];
const ROLES_REPORT = '/Custom/EquipRite/ROLES_RP.xdo';
const MAX_BODY = 100 * 1024 * 1024;
// The technical trace of a recorded test: how much of an answer is kept (lib/testTrace.js cuts what it shows further).
const TRACE_RAW_MAX = 4 * 1024 * 1024;
const APP_NAMES = { vbredwoodapp: 'Old', equiprite: 'New', 'equiprite-next': 'Next', 'equiprite-mobile': 'Mobile', 'equiprite-future': 'Future' };
const BACKEND_TIMEOUT_MS = 120000;

/** The role codes the app knows (app-flow.js persona map), offered when picking roles by hand. */
const KNOWN_ROLES = [
  'RT_EQP_ADMINISTRATOR',
  'RT_EQP_MANAGER',
  'RT_EQP_REQUESTOR',
  'RT_EQP_INSPECTION',
  'RT_EQP_TIMEKEEPER',
  'RT_EQP_TIME_APPROVER',
  'RT_EQP_FINANCE',
  'RT_EQP_EXTERNAL_REQUESTOR',
];

/**
 * Points every backend server at /__backend/<name> on `origin` and drops what would make VB route it through
 * VBCS's proxy (forceProxy, authentication). Returns the rewritten catalog and each backend's real URL and
 * VBCS credential id.
 */
function rewriteCatalog(catalog, origin) {
  const out = JSON.parse(JSON.stringify(catalog || {}));
  const backends = {};
  Object.keys(out.backends || {}).forEach((name) => {
    (out.backends[name].servers || []).forEach((server) => {
      const xvb = server['x-vb'] || {};
      const authenticated = (xvb.authentication && xvb.authentication.authenticated) || null;
      if (!backends[name]) {
        backends[name] = {
          url: String(server.url || '').replace(/\/+$/, ''),
          basic: !!(authenticated && authenticated.type === 'basic'),
          credentials: (authenticated && authenticated.credentials) || null,
        };
      }
      server.url = `${origin}/__backend/${encodeURIComponent(name)}`;
      delete xvb.forceProxy;
      delete xvb.authentication;
      xvb.anonymousAccess = true;
      server['x-vb'] = xvb;
    });
  });
  return { catalog: out, backends };
}

/** The VBCS credential the Fusion backends share (fusion / bipService); a local Fusion login stands in for it. */
function fusionCredential(backends) {
  const b = backends.fusion || backends.bipService;
  return (b && b.credentials) || null;
}

/** Fills the placeholders VBCS resolves when it serves app-flow.json. */
function fillAppFlow(text) {
  return String(text)
    .replace(/%\{env\.userProfileUrl\}%/g, '/_currentuser')
    .replace(/%\{env\.oauthUserProfileUrl\}%/g, '');
}

/** What VB's DefaultSecurityProvider reads; it only takes a user when isAnonymous is exactly false. */
function currentUser(identity) {
  const name = identity && identity.username;
  if (!name) {
    return { isAnonymous: true, roles: [], forbiddenPages: {} };
  }
  return {
    isAnonymous: false,
    id: name,
    userName: name,
    fullName: identity.fullName || name,
    email: identity.email || '',
    roles: ['approle.authenticated.user'],
    permissions: [],
    forbiddenPages: {},
  };
}

function xmlEscape(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

/** A runReport response for ROLES_RP carrying `roles`: DATA_DS / G_1 rows, base64 in ns2:reportBytes, as Fusion sends. */
function rolesReportResponse(username, roles) {
  const rows = (roles || []).map((r) => '<G_1>'
    + `<USERNAME>${xmlEscape(username)}</USERNAME>`
    + '<EMAIL_ADDRESS></EMAIL_ADDRESS>'
    + `<ORACLE_ROLE_COMMON_NAME>${xmlEscape(r)}</ORACLE_ROLE_COMMON_NAME>`
    + `<ORACLE_ROLE_DISPLAY>${xmlEscape(r)}</ORACLE_ROLE_DISPLAY>`
    + '</G_1>').join('');
  const data = `<?xml version="1.0" encoding="UTF-8"?><DATA_DS><P_LOGIN>${xmlEscape(username)}</P_LOGIN>${rows}</DATA_DS>`;
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Header/><env:Body>'
    + '<ns2:runReportResponse xmlns:ns2="http://xmlns.oracle.com/oxp/service/PublicReportService"><ns2:runReportReturn>'
    + `<ns2:reportBytes>${Buffer.from(data, 'utf8').toString('base64')}</ns2:reportBytes>`
    + '<ns2:reportContentType>text/xml</ns2:reportContentType>'
    + '</ns2:runReportReturn></ns2:runReportResponse></env:Body></env:Envelope>';
}

/** "EQP_CUSTOMERS_LOV_RP" from a runReport request, so the backend-calls log names the report, not the SOAP URL. */
function reportName(body) {
  const m = /<pub:reportAbsolutePath>([^<]+)<\/pub:reportAbsolutePath>/.exec(String(body || '').slice(0, 20000));
  return m ? path.posix.basename(m[1].trim(), '.xdo') : '';
}

function isRolesReport(body) {
  const s = String(body || '');
  return s.indexOf('runReport') >= 0 && s.indexOf(ROLES_REPORT) >= 0;
}

/** EQP_BACKEND_<NAME>=url points one backend somewhere else (e.g. another eqpt server), for this run only. */
function backendOverridesFromEnv(env) {
  const out = {};
  Object.keys(env || {}).forEach((k) => {
    const m = /^EQP_BACKEND_(.+)$/i.exec(k);
    if (m && env[k]) {
      out[m[1].toLowerCase()] = String(env[k]).replace(/\/+$/, '');
    }
  });
  return out;
}

/** webRoot-relative file for a URL path, or null when it would leave webRoot. */
function safeFile(webRoot, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const file = path.resolve(webRoot, `.${path.posix.normalize(`/${rel}`)}`);
  return file === webRoot || file.startsWith(webRoot + path.sep) ? file : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('request body too large'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, type, body, extra) {
  res.writeHead(status, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-cache' }, extra || {}));
  res.end(body);
}

function time() {
  return new Date().toTimeString().slice(0, 8);
}

/**
 * Starts the server. Resolves { server, port, url, close() }.
 * @param {object}   o
 * @param {string}   o.buildDir          the project's build/ folder (holds processed/)
 * @param {string}   [o.repoRoot]        the project folder (services/, webApps/); defaults to buildDir's parent
 * @param {string}   [o.webApp]          the web app under webApps/ to serve: 'vbredwoodapp' (Old EquipRite, the
 *                                       default) or 'equiprite' (New EquipRite). One server per web app, each at the
 *                                       site root as VB expects.
 * @param {Function} [o.getVersions]     () => { old: url, new: url }, served at /__versions so New EquipRite can
 *                                       link to a screen in the old app (under VBCS it derives the address instead)
 * @param {number}   o.port              0 picks a free one
 * @param {Function} o.getIdentity       () => { username, fullName?, email?, roles?: string[], fusion?: { user, password } }
 * @param {object}   [o.backendOverrides] { backendName(lower-case): url }
 * @param {Function} [o.onLog]            (line) => void, one line per backend call and per problem
 * @param {Function} [o.onProblem]        ({ kind: 'no-login'|'refused'|'unreachable', backend, report, host }) => void,
 *                                        when a Fusion call is refused (401/403) or a backend cannot be reached
 * @param {string}   [o.host]             the address to listen on: 127.0.0.1 (this PC only, the default), or 0.0.0.0
 *                                        for a phone on the same Wi-Fi (lib/phone.js), always with o.pairToken
 * @param {Function} [o.getPhone]         () => { vbcs, lan }: the addresses a phone opens EquipRite Mobile at (File > EquipRite
 *                                        on your phone), served at /__phone to this PC only, for Next's toolbar QR code
 * @param {object}   [o.phoneApp]         { apkFile, version }: EquipRite for Android, for a paired phone (with o.pairToken):
 *                                        /__app/info, /__app/EquipRite.apk, and /__app/open ("Open in the EquipRite
 *                                        app": into the app with this PC's address, or the download without it)
 * @param {object}   [o.futureStore]      EquipRite Future: its demo story's store (lib/futureDb.js, DuckDB in the desktop app's
 *                                        data folder), served to this PC only at /__future/story, /snapshots, /history,
 *                                        /sql (read-only) and /info, so the story survives restarts, rebuilds and a cleared cache
 * @param {object}   [o.sqlStore]         EquipRite Next's SQL worksheet (lib/oracleSql.js: Oracle connections kept on this PC,
 *                                        passwords in the OS keychain), served at /__sql/* to this PC only, by its own name, and
 *                                        only to the app's own page (the X-EquipRite-SQL header, which no other site can send)
 * @param {object}   [o.aiStore]          Ask AI in the SQL worksheet (lib/aiSql.js): the LLM chosen and its key, kept on this PC; served
 *                                        at /__sql/ai/* behind the same guard as /__sql/*
 * @param {object}   [o.jiraStore]        Connect Jira (lib/jiraAuth.js): the Jira site, email and API token kept on this PC, for the
 *                                        Jira stories page (Old and Next): /__jira/settings and /__jira/forget behind the /__sql
 *                                        guard (this PC, the X-EquipRite-Jira header); the token goes only into /__backend/jira calls
 * @param {object}   [o.recStore]         Test evidence for Jira stories (lib/testEvidence.js: recordings and screenshots kept on this PC,
 *                                        a folder per story): /__rec/* to this PC only; writes need the X-EquipRite-Rec header
 * @param {object}   [o.minutesStore]     Standup minutes (lib/minutes.js): the daily standup on the Jira backlog, kept on this PC, for
 *                                        EquipRite Next's Minutes page: /__minutes/* to this PC only, behind the X-EquipRite-Minutes
 *                                        header; voice→text reuses o.transcribe, "Format by AI" reuses o.aiStore (/__sql/ai/chat)
 * @param {object}   [o.analysisStore]    Saved AI analyses (lib/analyses.js), for EquipRite Next's Analyze with AI: kept on this PC so
 *                                        an analysis opens without asking the AI again: /__ai/* to this PC only, behind X-EquipRite-AI
 * @param {object}   [o.pagesStore]       The Application pages catalog (lib/pages.js): every VB page's technical sheet and the Jira stories
 *                                        mapped to it, saved into the project (git): /__pages/* to this PC only, behind X-EquipRite-Pages
 * @param {object}   [o.fddStore]         The FDD library (lib/fdd.js): FDDs saved into the project (git) for EquipRite Next's FDD library
 *                                        page and "Analyze with AI": /__fdd/* to this PC only, behind the X-EquipRite-FDD header.
 *                                        Its JSON files are also written into this server's build copy, so the app sees an upload
 *                                        without a rebuild
 * @param {Function} [o.pairToken]        () => the pairing key, or null. Given, a request from another device is
 *                                        served only with the key (the QR code's address, then its cookie), never
 *                                        the web services page; this PC's own requests are unaffected
 */
function createDevServer(o) {
  const processed = path.join(o.buildDir, 'processed');
  const webRoot = path.join(processed, 'webApps', o.webApp || 'vbredwoodapp');
  const catalogFile = path.join(processed, 'services', 'catalog.json');
  const repoRoot = o.repoRoot || path.dirname(o.buildDir);
  // The FDD library writes into the project; the app reads the built copy (webApps/<app>/version_<n>/resources/fdd), so an
  // upload is also written there — the newest version folder, looked up at write time since every build makes a new one.
  if (o.pagesStore && o.pagesStore.setMirror && (o.webApp || '') === 'equiprite-next') {
    o.pagesStore.setMirror(() => {
      const v = fs.readdirSync(webRoot).filter((n) => /^version_/.test(n)).sort().pop();
      return path.join(webRoot, v || '', 'resources', 'pages');
    });
  }
  if (o.fddStore && o.fddStore.setMirror && (o.webApp || '') === 'equiprite-next') {
    o.fddStore.setMirror(() => {
      const v = fs.readdirSync(webRoot).filter((n) => /^version_/.test(n)).sort().pop();
      return path.join(webRoot, v || '', 'resources', 'fdd');
    });
  }
  const overrides = o.backendOverrides || {};
  const log = (line) => (o.onLog ? o.onLog(`${time()} ${line}`) : undefined);
  let backends = {};

  const loadCatalog = (origin) => {
    const rewritten = rewriteCatalog(JSON.parse(fs.readFileSync(catalogFile, 'utf8')), origin);
    backends = rewritten.backends;
    return rewritten.catalog;
  };

  async function proxy(req, res, name, rest, search) {
    if (!backends[name]) {
      loadCatalog(`http://${req.headers.host}`);
    }
    const backend = backends[name];
    if (!backend) {
      return send(res, 404, 'application/json', JSON.stringify({ error: `no backend "${name}" in services/catalog.json` }));
    }
    const identity = o.getIdentity() || {};
    const body = await readBody(req);
    const started = Date.now();
    const report = backend.basic ? reportName(body) : '';
    const label = `${req.method} ${name} ${report || `${rest}${search}`}`.slice(0, 220);
    const usesFusionLogin = backend.basic && backend.credentials === fusionCredential(backends);
    const problem = (p) => (o.onProblem ? o.onProblem(Object.assign({ backend: name, report }, p)) : undefined);

    if (identity.roles && identity.roles.length && isRolesReport(body)) {
      log(`${label} -> roles answered locally: ${identity.roles.join(', ')}`);
      return send(res, 200, 'application/soap+xml; charset=utf-8', rolesReportResponse(identity.username, identity.roles));
    }

    // Connect Jira (lib/jiraAuth.js): the jira backend goes to the site the person connected, with their email and token.
    const jira = name === 'jira' && o.jiraStore ? o.jiraStore.auth() : null;
    const base = overrides[name.toLowerCase()] || (jira && jira.site) || backend.url;
    let target;
    try {
      target = new URL(`${base}${rest}${search}`);
    } catch {
      return send(res, 502, 'application/json', JSON.stringify({ error: `bad backend URL ${base}` }));
    }
    const headers = Object.assign({}, req.headers);
    ['host', 'origin', 'referer', 'cookie', 'authorization', ...HOP_BY_HOP].forEach((h) => delete headers[h]);
    headers.host = target.host;
    headers['content-length'] = String(body.length);
    const fusion = identity.fusion;
    if (usesFusionLogin && fusion && fusion.user && fusion.password) {
      headers.authorization = `Basic ${Buffer.from(`${fusion.user}:${fusion.password}`).toString('base64')}`;
    }
    if (jira) headers.authorization = jira.header;

    // Record on a Jira story, with its technical trace (lib/testTrace.js): while a traced recording runs, each call is
    // kept with what was sent and answered (secrets masked). Not Jira's own calls: they are the test tool's, not the app's.
    const rs = o.recStore;
    const tracing = !!(rs && rs.tracing && rs.tracing() && name !== 'jira');
    const resChunks = [];
    let resSize = 0;
    const trace = (status, resHeaders, error) => {
      if (!tracing) return;
      try {
        rs.traceAdd(TT.callEntry({ t: started, app: APP_NAMES[o.webApp] || o.webApp, method: req.method, service: name, path: `${rest}${search}`, url: target.href, status,
          ms: Date.now() - started, error, reqHeaders: req.headers, reqBody: TT.bodyText(body, req.headers), resHeaders,
          // the login that actually went to the backend (the proxy adds it): its scheme and, for Basic, the username — never the secret
          auth: TT.authOf(headers),
          resBody: resHeaders ? TT.bodyText(Buffer.concat(resChunks), resHeaders) : '' }));
      } catch (e) { log(`trace: ${e.message}`); }
    };

    await new Promise((resolve) => {
      const mod = target.protocol === 'https:' ? https : http;
      const preq = mod.request(target, { method: req.method, headers, timeout: BACKEND_TIMEOUT_MS }, (pres) => {
        const out = Object.assign({}, pres.headers);
        // A 401 challenge would make the window pop a browser login box; the app handles the 401 itself.
        ['www-authenticate', 'set-cookie', ...HOP_BY_HOP].forEach((h) => delete out[h]);
        res.writeHead(pres.statusCode || 502, out);
        pres.pipe(res);
        if (tracing) pres.on('data', (c) => { if (resSize < TRACE_RAW_MAX) { resChunks.push(c); resSize += c.length; } });
        pres.on('end', () => {
          trace(pres.statusCode, pres.headers);
          const refused = usesFusionLogin && (pres.statusCode === 401 || pres.statusCode === 403);
          let note = '';
          if (refused && !headers.authorization) {
            note = ' (no Fusion login: File > Sign in as…)';
          } else if (refused) {
            note = pres.statusCode === 401 ? ' (Fusion refused the login)' : ' (the Fusion login may not run this)';
          } else if (pres.statusCode === 401 && backend.basic) {
            note = ' (its VBCS credential is not available locally)';
          }
          log(`${label} -> ${pres.statusCode} (${Date.now() - started} ms)${note}`);
          if (refused) {
            problem({ kind: headers.authorization ? 'refused' : 'no-login', status: pres.statusCode });
          }
          resolve();
        });
        pres.on('error', resolve);
      });
      preq.on('timeout', () => preq.destroy(new Error(`no answer in ${BACKEND_TIMEOUT_MS / 1000}s`)));
      preq.on('error', (e) => {
        log(`${label} -> FAILED: ${e.message} (${target.origin})`);
        trace(0, null, e.message);
        problem({ kind: 'unreachable', host: target.origin, error: e.message });
        if (!res.headersSent) {
          send(res, 502, 'application/json', JSON.stringify({ error: `EquipRite local server could not reach ${name} at ${target.origin}: ${e.message}` }));
        } else {
          res.destroy();
        }
        resolve();
      });
      preq.end(body);
    });
  }

  function serveFile(req, res, pathname) {
    const file = safeFile(webRoot, pathname === '/' ? '/index.html' : pathname);
    if (!file) {
      return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        // Router strategy "path": a reload on /some/page must get the app shell, not a 404.
        if (!path.extname(pathname)) {
          return serveFile(req, res, '/index.html');
        }
        return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
      }
      const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
      if (/[\\/]version_[^\\/]+[\\/]app-flow\.json$/.test(file)) {
        return send(res, 200, type, fillAppFlow(fs.readFileSync(file, 'utf8')));
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') {
        return res.end();
      }
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://local');
    const pathname = u.pathname;
    Promise.resolve().then(() => {
      // Another device (a phone on the Wi-Fi) acts as the person signed in here: only with the pairing key.
      if (o.pairToken && !isLoopback(req.socket.remoteAddress)) {
        const pass = pairCheck(o.pairToken(), u.searchParams, req.headers.cookie);
        if (!pass.ok) {
          log(`${req.method} ${pathname} -> refused: ${req.socket.remoteAddress} has not scanned the pairing code`);
          return send(res, 403, 'text/html; charset=utf-8', NOT_PAIRED_HTML);
        }
        if (pass.setCookie) {
          res.setHeader('Set-Cookie', pass.setCookie);
        }
        if (pathname.startsWith('/__services')) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
      }
      if (pathname === '/__services') {
        res.writeHead(302, { Location: '/__services/' });
        return res.end();
      }
      if (pathname === '/__services/' || pathname === '/__services/web-services.js') {
        const name = pathname.endsWith('.js') ? 'web-services.js' : 'web-services.html';
        return send(res, 200, TYPES[path.extname(name)], fs.readFileSync(path.join(DESKTOP_DIR, name)));
      }
      if (pathname === '/__services/data.json') {
        const data = buildCatalog(repoRoot);
        const id = o.getIdentity() || {};
        data.identity = {
          username: id.username || '',
          roles: id.roles || null,
          hasFusionLogin: !!(id.fusion && id.fusion.password),
          fusionUser: (id.fusion && id.fusion.user) || '',
        };
        return send(res, 200, 'application/json', JSON.stringify(data));
      }
      if (pathname === '/_currentuser') {
        return send(res, 200, 'application/json', JSON.stringify(currentUser(o.getIdentity())));
      }
      if (o.phoneApp && pathname.startsWith('/__app/')) {
        const apk = o.phoneApp.apkFile && fs.existsSync(o.phoneApp.apkFile) ? o.phoneApp.apkFile : '';
        if (pathname === '/__app/info') {
          return send(res, 200, 'application/json', JSON.stringify(apk ? { android: { version: o.phoneApp.version || '', bytes: fs.statSync(apk).size } } : {}));
        }
        if (pathname === APK_PATH && apk) {
          return send(res, 200, 'application/vnd.android.package-archive', fs.readFileSync(apk),
            { 'Content-Disposition': 'attachment; filename="EquipRite.apk"' });
        }
        const token = o.pairToken ? o.pairToken() : null;
        if (pathname === '/__app/open' && apk && token) {
          res.writeHead(302, { Location: appIntent(String(req.headers.host || ''), token), 'Cache-Control': 'no-store' });
          return res.end();
        }
        return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
      }
      if (pathname === '/__phone') {
        // This PC only, and only by its own name (not a page on another site that renamed itself to this address).
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        return send(res, 200, 'application/json', JSON.stringify((o.getPhone && o.getPhone()) || {}));
      }
      if (pathname.startsWith('/__future/') && o.futureStore) {
        // EquipRite Future's story in DuckDB (lib/futureDb.js): this PC only, by its own name.
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const fs_ = o.futureStore;
        const json = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 20 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 20 * 1024 * 1024 ? reject(new Error('Too large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        const snap = /^\/__future\/snapshots\/(\d+)$/.exec(pathname);
        const hist = /^\/__future\/history\/(\d+)$/.exec(pathname);
        (async () => {
          if (pathname === '/__future/info') return json(200, await fs_.info());
          if (pathname === '/__future/story' && req.method === 'GET') {
            const text = await fs_.load();
            return text ? send(res, 200, 'application/json', text, { 'Cache-Control': 'no-store' }) : json(200, null);
          }
          if (pathname === '/__future/story' && (req.method === 'PUT' || req.method === 'POST')) return json(200, await fs_.save(await bodyOf()));
          if (pathname === '/__future/snapshots' && req.method === 'GET') return json(200, await fs_.snapshots());
          if (pathname === '/__future/snapshots' && req.method === 'POST') {
            const b = JSON.parse(await bodyOf() || '{}');
            return json(200, await fs_.saveSnapshot(b.name, b.story ? JSON.stringify(b.story) : await fs_.load()));
          }
          if (snap && req.method === 'GET') { const t = await fs_.loadSnapshot(snap[1]); return t ? send(res, 200, 'application/json', t) : json(404, {}); }
          if (snap && req.method === 'DELETE') return json(200, await fs_.deleteSnapshot(snap[1]));
          if (pathname === '/__future/history' && req.method === 'GET') return json(200, await fs_.history());
          if (pathname === '/__future/erase' && req.method === 'POST') return json(200, await fs_.erase());
          if (hist && req.method === 'GET' && fs_.loadHistory) { const t = await fs_.loadHistory(hist[1]); return t ? send(res, 200, 'application/json', t) : json(404, {}); }
          if (pathname === '/__future/sql' && req.method === 'POST') {
            const b = JSON.parse(await bodyOf() || '{}');
            try { return json(200, await fs_.query(b.sql)); } catch (e) { return json(400, { error: e.message }); }
          }
          return json(404, { error: 'Not found' });
        })().catch((e) => json(400, { error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__rec/') && o.recStore) {
        // Test evidence for a Jira story (Record, Screenshot on the story's panel): this PC only, by its own name. Reads
        // (the list, a file for <video>/<img>, which cannot send a header) need only that; writes also need the page's
        // X-EquipRite-Rec header and its own origin, which a page of another site cannot send without a preflight.
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const rs = o.recStore;
        const json = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        const q = (k) => u.searchParams.get(k) || '';
        const fileMatch = /^\/__rec\/file\/([^/]+)\/([^/]+)$/.exec(pathname);
        if (req.method === 'GET' && fileMatch) {
          const file = rs.file(decodeURIComponent(fileMatch[1]), decodeURIComponent(fileMatch[2]));
          if (!file) return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
          const size = fs.statSync(file).size;
          const type = /\.png$/i.test(file) ? 'image/png' : /\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.webp$/i.test(file) ? 'image/webp'
            : /\.mp4$/i.test(file) ? 'video/mp4' : 'video/webm';
          // Ranges, so the video player can seek
          const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
          if (range && size) {
            const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2] || 0));
            const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
            if (start > end || start >= size) {
              res.writeHead(416, { 'Content-Range': `bytes */${size}` });
              return res.end();
            }
            res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`,
              'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
            fs.createReadStream(file, { start, end }).pipe(res);
            return undefined;
          }
          res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
          fs.createReadStream(file).pipe(res);
          return undefined;
        }
        // The technical trace of a recording: its timeline (the viewer), as a HAR file, and the failure in words.
        const traceMatch = /^\/__rec\/(trace|har|report)\/([^/]+)\/([^/]+)$/.exec(pathname);
        if (req.method === 'GET' && traceMatch) {
          const key = decodeURIComponent(traceMatch[2]);
          const nm = decodeURIComponent(traceMatch[3]);
          if (traceMatch[1] === 'trace') { const tr = rs.trace(key, nm); return tr ? json(200, tr) : json(404, { error: 'No trace for this recording.' }); }
          if (traceMatch[1] === 'report') { const txt = rs.report(key, nm); return txt ? send(res, 200, 'text/plain; charset=utf-8', txt) : send(res, 404, 'text/plain; charset=utf-8', 'No trace'); }
          const har = rs.har(key, nm);
          if (!har) return json(404, { error: 'No trace for this recording.' });
          const file = `${key} ${nm.replace(/\.[a-z0-9]+$/i, '')}.har`.replace(/[^\w .()-]/g, '_');
          return send(res, 200, 'application/json', JSON.stringify(har, null, 1), { 'Content-Disposition': `attachment; filename="${file}"`, 'Cache-Control': 'no-store' });
        }
        // A recording's transcript (lib/transcribe.js): the viewer's JSON, or a plain-text / SRT download.
        const txMatch = /^\/__rec\/(transcript|transcript\.srt|transcript\.txt)\/([^/]+)\/([^/]+)$/.exec(pathname);
        if (req.method === 'GET' && txMatch) {
          const key = decodeURIComponent(txMatch[2]);
          const nm = decodeURIComponent(txMatch[3]);
          if (txMatch[1] === 'transcript') { const t = rs.transcript(key, nm); return t ? json(200, t) : json(404, { error: 'This recording has no transcript yet.' }); }
          const body = txMatch[1] === 'transcript.srt' ? rs.transcriptSrt(key, nm) : rs.transcriptText(key, nm);
          if (!body) return send(res, 404, 'text/plain; charset=utf-8', 'No transcript');
          const file = `${key} ${nm.replace(/\.[a-z0-9]+$/i, '')}.${txMatch[1] === 'transcript.srt' ? 'srt' : 'txt'}`.replace(/[^\w .()-]/g, '_');
          return send(res, 200, 'text/plain; charset=utf-8', body, { 'Content-Disposition': `attachment; filename="${file}"`, 'Cache-Control': 'no-store' });
        }
        if (req.method === 'GET' && pathname === '/__rec/status') { return json(200, rs.status(q('id')) || { error: 'No recording in progress.' }); }
        if (req.method === 'GET' && pathname === '/__rec/info') return json(200, { available: true, dir: rs.dir });
        // Which transcription engines are set up (local Whisper on this PC, or OpenAI with the Ask AI key).
        if (req.method === 'GET' && pathname === '/__rec/transcribe-info') return json(200, o.transcribe ? o.transcribe.info() : { engines: [], local: { ready: false }, openai: { ready: false } });
        // Which stories have recordings or screenshots (the lists' icon), in one read.
        if (req.method === 'GET' && pathname === '/__rec/index') return json(200, rs.index());
        if (req.method === 'GET' && pathname === '/__rec/list') {
          try { return json(200, rs.list(q('key'))); } catch (e) { return json(200, { error: e.message }); }
        }
        const origin = req.headers.origin;
        if (req.headers['x-equiprite-rec'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from EquipRite on this PC.' }));
        }
        (async () => {
          if (req.method !== 'POST') return json(404, { error: 'Not found' });
          if (pathname === '/__rec/start') {
            const st = rs.start(q('key'), q('ext'), { trace: q('trace') === '1' });
            log(`Recording ${q('key')}${st.trace ? ' with its technical trace (web service calls, console errors)' : ''}: ${st.name}`);
            return json(200, st);
          }
          if (pathname === '/__rec/chunk') return json(200, rs.chunk(q('id'), await readBody(req)));
          if (pathname === '/__rec/finish') {
            const item = rs.finish(q('id'));
            if (item) log(`Recording saved for ${q('key') || 'a story'}: ${item.name} (${Math.round(item.size / 1024)} KB)`);
            return json(200, { item });
          }
          if (pathname === '/__rec/image') {
            const item = rs.image(q('key'), await readBody(req), q('ext'));
            log(`Screenshot saved for ${q('key')}: ${item.name}`);
            return json(200, { item });
          }
          if (pathname === '/__rec/reveal') return json(200, rs.reveal(q('key')));
          if (pathname === '/__rec/remove') return json(200, rs.remove(q('key'), q('name')));
          // Transcribe a recording's voice with Whisper (local on this PC, or OpenAI), then keep the transcript next to it.
          // Set up local Whisper: download a model into the models folder, or open that folder.
          if (pathname === '/__rec/transcribe-model') {
            if (!o.transcribe) return json(200, { ok: false, error: 'Transcription is not available.' });
            const r = await o.transcribe.downloadModel(q('name'));
            if (r.ok) log(`Downloaded Whisper model ${r.name} (${Math.round(r.size / 1048576)} MB)`);
            return json(200, r);
          }
          if (pathname === '/__rec/transcribe-reveal') { return json(200, o.transcribe ? o.transcribe.revealModels() : { error: 'Transcription is not available.' }); }
          // Run the installer for a missing piece (the setup helper's Install button): winget / brew.
          if (pathname === '/__rec/transcribe-install') {
            if (!o.transcribe || !o.transcribe.install) return json(200, { ok: false, error: 'Transcription is not available.' });
            const r = await o.transcribe.install(q('what'));
            log(`Install ${q('what')} (${r.cmd || ''}): ${r.ok ? 'done' : 'failed'}`);
            return json(200, r);
          }
          if (pathname === '/__rec/transcribe') {
            if (!o.transcribe) return json(200, { ok: false, error: 'Transcription is not available.' });
            const file = rs.file(q('key'), q('name'));
            if (!file) return json(200, { ok: false, error: 'The recording was not found.' });
            const r = await o.transcribe.transcribe(file, { engine: q('engine'), lang: q('lang') });
            if (!r.ok) return json(200, r);
            const item = rs.saveTranscript(q('key'), q('name'), r);
            log(`Transcribed ${q('key')} ${q('name')} with ${r.engine} Whisper: ${(r.segments || []).length} lines (${Math.round((r.ms || 0) / 100) / 10}s)`);
            return json(200, { ok: true, engine: r.engine, lang: r.lang, lines: (r.segments || []).length, item });
          }
          return json(404, { error: 'Not found' });
        })().catch((e) => json(200, { error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__jira/') && o.jiraStore) {
        // Connect Jira, for the Jira stories page: this PC only, by its own name, and only the app's own page (it sends
        // X-EquipRite-Jira, which a page of another site cannot send without a preflight this server never allows).
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const origin = req.headers.origin;
        if (req.headers['x-equiprite-jira'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from EquipRite on this PC.' }));
        }
        const js = o.jiraStore;
        const json = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        (async () => {
          if (pathname === '/__jira/settings' && req.method === 'GET') return json(200, js.settings());
          if (pathname === '/__jira/settings' && req.method === 'POST') {
            const b = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            try {
              const r = js.save(b);
              log(`Jira connected as ${r.email} on ${r.site}`);
              return json(200, r);
            } catch (e) { return json(200, { error: e.message }); }
          }
          if (pathname === '/__jira/forget' && req.method === 'POST') { log('Jira disconnected'); return json(200, js.forget()); }
          return json(404, { error: 'Not found' });
        })().catch((e) => json(200, { error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__minutes/')) {
        // Standup minutes (lib/minutes.js), for EquipRite Next's Minutes page: this PC only, by its own name, and only the
        // app's own page (it sends X-EquipRite-Minutes, which a page of another site cannot send without a preflight this
        // server never allows). The meeting notes stay on this PC; the Teams webhook is the only secret, kept encrypted.
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonM = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.minutesStore) return jsonM(200, { ok: false, error: 'Minutes is not set up in this app.' });
        const origin = req.headers.origin;
        if (req.headers['x-equiprite-minutes'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from EquipRite Next on this PC.' }));
        }
        const ms = o.minutesStore;
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 30 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 30 * 1024 * 1024 ? reject(new Error('Too large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        const post = req.method === 'POST';
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          if (pathname === '/__minutes/settings' && req.method === 'GET') return jsonM(200, await ms.settings());
          if (pathname === '/__minutes/settings' && post) { try { return jsonM(200, await ms.saveSettings(b)); } catch (e) { return jsonM(200, { ok: false, error: e.message }); } }
          if (pathname === '/__minutes/list' && req.method === 'GET') return jsonM(200, await ms.list());
          if (pathname === '/__minutes/get' && req.method === 'GET') return jsonM(200, await ms.get(u.searchParams.get('id') || ''));
          if (pathname === '/__minutes/save' && post) { try { return jsonM(200, await ms.save(b)); } catch (e) { return jsonM(200, { ok: false, error: e.message }); } }
          if (pathname === '/__minutes/remove' && post) return jsonM(200, await ms.remove(b.id));
          if (pathname === '/__minutes/dictate' && post) return jsonM(200, await ms.dictate(b));
          if (pathname === '/__minutes/teams' && post) return jsonM(200, await ms.sendTeams(b));
          if (pathname === '/__minutes/contacts' && req.method === 'GET') return jsonM(200, ms.contacts ? await ms.contacts(u.searchParams.get('q') || '') : { ok: false, available: false, contacts: [] });
          if (pathname === '/__minutes/outlook' && post) return jsonM(200, ms.sendOutlook ? await ms.sendOutlook(b) : { ok: false, available: false, error: 'Sending via Outlook is not available.' });
          if (pathname === '/__minutes/send' && post) return jsonM(200, ms.sendMail ? await ms.sendMail(b) : { ok: false, error: 'Sending is not available.' });
          if (pathname === '/__minutes/graph/status' && req.method === 'GET') return jsonM(200, ms.graphStatus ? ms.graphStatus() : { configured: false, signedIn: false });
          if (pathname === '/__minutes/graph/poll' && post) return jsonM(200, ms.graphPoll ? await ms.graphPoll() : (ms.graphStatus ? ms.graphStatus() : { configured: false, signedIn: false }));
          if (pathname === '/__minutes/graph/config' && post) return jsonM(200, ms.graphConfig ? await ms.graphConfig(b) : { ok: false });
          if (pathname === '/__minutes/graph/signin' && post) return jsonM(200, ms.graphBegin ? await ms.graphBegin() : { ok: false, error: 'Microsoft 365 is not available.' });
          if (pathname === '/__minutes/graph/interactive' && post) return jsonM(200, ms.graphInteractive ? await ms.graphInteractive() : { ok: false, error: 'In-app sign-in is not available.' });
          if (pathname === '/__minutes/graph/signout' && post) return jsonM(200, ms.graphSignOut ? await ms.graphSignOut() : { ok: false });
          if (pathname === '/__minutes/graph/test' && post) return jsonM(200, ms.graphTest ? await ms.graphTest(b) : { ok: false, error: 'Microsoft 365 is not available.' });
          if (pathname === '/__minutes/graph/send' && post) return jsonM(200, ms.graphSend ? await ms.graphSend(b) : { ok: false, error: 'Microsoft 365 is not available.' });
          return jsonM(404, { error: 'Not found' });
        })().catch((e) => jsonM(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__followups/')) {
        // Saved follow-ups (lib/followups.js), for EquipRite Next's Follow-ups page: this PC only, by its own name, and
        // only the app's own page (it sends X-EquipRite-Followups, which a page of another site cannot send without a
        // preflight this server never allows). The follow-ups stay on this PC in DuckDB.
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonF = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.followupsStore) return jsonF(200, { ok: false, error: 'Follow-ups is not set up in this app.' });
        const origin = req.headers.origin;
        if (req.headers['x-equiprite-followups'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from EquipRite Next on this PC.' }));
        }
        const fsStore = o.followupsStore;
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 30 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 30 * 1024 * 1024 ? reject(new Error('Too large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        const post = req.method === 'POST';
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          if (pathname === '/__followups/list' && req.method === 'GET') return jsonF(200, await fsStore.list());
          if (pathname === '/__followups/get' && req.method === 'GET') return jsonF(200, await fsStore.get(u.searchParams.get('id') || ''));
          if (pathname === '/__followups/save' && post) { try { return jsonF(200, await fsStore.save(b)); } catch (e) { return jsonF(200, { ok: false, error: e.message }); } }
          if (pathname === '/__followups/remove' && post) return jsonF(200, await fsStore.remove(b.id));
          return jsonF(404, { error: 'Not found' });
        })().catch((e) => jsonF(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__ai/')) {
        // Saved AI analyses (lib/analyses.js): this PC only, by its own name, and only the app's own page (it sends
        // X-EquipRite-AI, which a page of another site cannot send without a preflight this server never allows).
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonA = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.analysisStore) return jsonA(200, { ok: false, error: 'Saved analyses are not set up in this app.' });
        const origin = req.headers.origin;
        if (req.headers['x-equiprite-ai'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from EquipRite Next on this PC.' }));
        }
        const as = o.analysisStore;
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 8 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 8 * 1024 * 1024 ? reject(new Error('Too large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        const post = req.method === 'POST';
        const who = () => { try { const id = o.getIdentity && o.getIdentity(); return (id && (id.displayName || id.username)) || ''; } catch (e) { return ''; } };
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          if (pathname === '/__ai/index' && req.method === 'GET') return jsonA(200, as.index());
          if (pathname === '/__ai/get' && req.method === 'GET') return jsonA(200, as.get(u.searchParams.get('key') || ''));
          if (pathname === '/__ai/save' && post) return jsonA(200, as.save(Object.assign({}, b, { by: b.by || who() })));
          if (pathname === '/__ai/chat' && post) return jsonA(200, as.chat(b.key, b.chat));
          if (pathname === '/__ai/remove' && post) return jsonA(200, as.remove(b.key));
          return jsonA(404, { error: 'Not found' });
        })().catch((e) => jsonA(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__pages/')) {
        // The Application pages catalog (lib/pages.js): build a page's technical sheet, map Jira stories to it, its
        // screenshot (captured by the desktop app, or uploaded), its AI explanation, and commit + push those files. This PC
        // only, and only the app's own page (X-EquipRite-Pages). Reading the catalog needs none of this: it ships with the app.
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonP = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.pagesStore) return jsonP(200, { ok: false, error: 'The Application pages catalog is not set up in this app.' });
        const origin = req.headers.origin;
        if (req.headers['x-equiprite-pages'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from EquipRite Next on this PC.' }));
        }
        const ps = o.pagesStore;
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 16 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 16 * 1024 * 1024 ? reject(new Error('Too large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        const post = req.method === 'POST';
        const who = () => { try { const id = o.getIdentity && o.getIdentity(); return (id && (id.displayName || id.username)) || ''; } catch (e) { return ''; } };
        const commit = async (r, b, msg) => { if (r && r.ok && b.commit) r.git = await ps.gitSave({ message: msg, push: b.push !== false }); return r; };
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          const by = who();
          if (pathname === '/__pages/info' && req.method === 'GET') return jsonP(200, { ok: true, canWrite: ps.canWrite(), canCapture: ps.canCapture() });
          if (pathname === '/__pages/catalog' && req.method === 'GET') return jsonP(200, Object.assign({ ok: true }, ps.catalog()));
          if (pathname === '/__pages/sheet' && req.method === 'GET') return jsonP(200, ps.sheet(u.searchParams.get('id') || ''));
          if (pathname === '/__pages/git/status' && req.method === 'GET') return jsonP(200, Object.assign({ ok: true }, await ps.gitStatus()));
          if (pathname === '/__pages/rescan' && post) return jsonP(200, await commit(ps.rescan(), b, 'Application pages: rescan'));
          if (pathname === '/__pages/build' && post) return jsonP(200, await commit(ps.build(b.id, { by }), b, 'Application pages: sheet of ' + b.id));
          if (pathname === '/__pages/assign' && post) {
            const r = ps.assign(b.id, b.key, { by });
            log(`Pages: ${b.key} -> ${b.id} ${r.ok ? (r.built ? '(sheet built)' : '(sheet reused)') : r.error}`);
            return jsonP(200, await commit(r, b, 'Application pages: map ' + String(b.key || '').toUpperCase() + ' to ' + b.id));
          }
          if (pathname === '/__pages/unassign' && post) return jsonP(200, await commit(ps.unassign(b.id, b.key), b, 'Application pages: unmap ' + String(b.key || '').toUpperCase() + ' from ' + b.id));
          if (pathname === '/__pages/shot' && post) return jsonP(200, await commit(ps.saveShot(b.id, Object.assign({}, b, { by, source: 'upload' })), b, 'Application pages: screenshot of ' + b.id));
          if (pathname === '/__pages/capture' && post) {
            const r = await ps.capture(b.id, { by });
            log(`Pages: capture ${b.id} -> ${r.ok ? r.file : r.error}`);
            return jsonP(200, await commit(r, b, 'Application pages: screenshot of ' + b.id));
          }
          if (pathname === '/__pages/ai' && post) return jsonP(200, await commit(ps.saveAi(b.id, Object.assign({}, b, { by })), b, 'Application pages: AI explanation of ' + b.id));
          if (pathname === '/__pages/git/save' && post) return jsonP(200, await ps.gitSave({ message: b.message, push: b.push !== false }));
          return jsonP(404, { error: 'Not found' });
        })().catch((e) => jsonP(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__fdd/')) {
        // The FDD library (lib/fdd.js), for EquipRite Next's FDD library page: upload an FDD into the project, make one the
        // latest, remove one, and commit + push those files to git. This PC only, by its own name, and only the app's own
        // page (it sends X-EquipRite-FDD, which a page of another site cannot send without a preflight this server never
        // allows). Reading the library needs none of this: it ships with the app (resources/fdd).
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const jsonD = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        if (!o.fddStore) return jsonD(200, { ok: false, error: 'The FDD library is not set up in this app.' });
        const origin = req.headers.origin;
        if (req.headers['x-equiprite-fdd'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from EquipRite Next on this PC.' }));
        }
        const fd = o.fddStore;
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 90 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 90 * 1024 * 1024 ? reject(new Error('The file is too large to upload.')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        const post = req.method === 'POST';
        const who = () => { try { const id = o.getIdentity && o.getIdentity(); return (id && (id.displayName || id.username)) || ''; } catch (e) { return ''; } };
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          if (pathname === '/__fdd/info' && req.method === 'GET') return jsonD(200, fd.info());
          if (pathname === '/__fdd/outline' && req.method === 'GET') return jsonD(200, fd.outline(u.searchParams.get('id') || ''));
          if (pathname === '/__fdd/git/status' && req.method === 'GET') return jsonD(200, Object.assign({ ok: true }, await fd.gitStatus()));
          if (pathname === '/__fdd/original' && req.method === 'GET') {
            const f = fd.original(u.searchParams.get('id') || '');
            if (!f.ok) return jsonD(404, f);
            return send(res, 200, f.mime, fs.readFileSync(f.file), { 'Cache-Control': 'no-store', 'Content-Disposition': `attachment; filename="${encodeURIComponent(f.name)}"` });
          }
          if (pathname === '/__fdd/upload' && post) {
            const r = await fd.upload(Object.assign({}, b, { by: b.by || who() }));
            log(`FDD upload ${b.fileName || ''} -> ${r.ok ? r.doc.id + ', ' + r.doc.sections + ' sections' : r.error}`);
            if (r.ok && b.commit) {
              r.git = await fd.gitSave({ message: `FDD library: add ${r.doc.name}${r.doc.version ? ' v' + r.doc.version : ''}${r.latest === r.doc.id ? ' (latest)' : ''}`, push: b.push !== false });
              log(`FDD git -> ${r.git.ok ? (r.git.committed || 'nothing to commit') + (r.git.pushed ? ', pushed to ' + r.git.upstream : '') : r.git.error}`);
            }
            return jsonD(200, r);
          }
          if (pathname === '/__fdd/latest' && post) {
            const r = fd.setLatest(b.id);
            if (r.ok && b.commit) r.git = await fd.gitSave({ message: `FDD library: ${b.id} is the latest`, push: b.push !== false });
            return jsonD(200, r);
          }
          if (pathname === '/__fdd/remove' && post) {
            const r = fd.remove(b.id);
            if (r.ok && b.commit) r.git = await fd.gitSave({ message: `FDD library: remove ${b.id}`, push: b.push !== false });
            return jsonD(200, r);
          }
          if (pathname === '/__fdd/git/save' && post) {
            const r = await fd.gitSave({ message: b.message, push: b.push !== false });
            log(`FDD git -> ${r.ok ? (r.committed || 'nothing to commit') + (r.pushed ? ', pushed to ' + r.upstream : '') : r.error}`);
            return jsonD(200, r);
          }
          return jsonD(404, { error: 'Not found' });
        })().catch((e) => jsonD(200, { ok: false, error: e.message }));
        return undefined;
      }
      if (pathname.startsWith('/__sql/') && (o.sqlStore || o.aiStore)) {
        // EquipRite Next's SQL worksheet (lib/oracleSql.js). This PC only, by its own name; and only the app's own page:
        // it sends X-EquipRite-SQL, which a page of another site cannot send without a preflight this server never allows.
        const host = String(req.headers.host || '').replace(/:\d+$/, '');
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host)) {
          return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
        }
        const origin = req.headers.origin;
        if (req.headers['x-equiprite-sql'] !== '1' || (origin && origin !== `http://${req.headers.host}`)) {
          return send(res, 403, 'application/json', JSON.stringify({ error: 'Refused: not from EquipRite Next on this PC.' }));
        }
        const sq = o.sqlStore;
        const json = (status, body) => send(res, status, 'application/json', JSON.stringify(body), { 'Cache-Control': 'no-store' });
        const bodyOf = () => new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => { size += c.length; if (size <= 2 * 1024 * 1024) chunks.push(c); });
          req.on('end', () => (size > 2 * 1024 * 1024 ? reject(new Error('Too large')) : resolve(Buffer.concat(chunks).toString('utf8'))));
          req.on('error', reject);
        });
        const post = req.method === 'POST';
        const conn = /^\/__sql\/connections\/([A-Za-z0-9]+)$/.exec(pathname);
        const started = Date.now();
        (async () => {
          const b = post ? JSON.parse((await bodyOf()) || '{}') : {};
          if (pathname === '/__sql/info') return json(200, sq.info());
          if (pathname === '/__sql/connections' && req.method === 'GET') return json(200, sq.list());
          if (pathname === '/__sql/connections' && post) return json(200, sq.save(b));
          if (conn && req.method === 'DELETE') return json(200, sq.remove(conn[1]));
          if (pathname === '/__sql/tns') return json(200, sq.tnsAliases(u.searchParams.get('dir') || ''));
          if (pathname === '/__sql/sessions') return json(200, sq.sessions());
          if (pathname === '/__sql/test' && post) {
            const r = await sq.test(b);
            log(`SQL test ${b.name || ''} -> ${r.ok ? 'ok' : 'failed'} (${r.ms} ms)`);
            return json(200, r);
          }
          if (pathname === '/__sql/connect' && post) {
            const r = await sq.connect(b);
            log(`SQL connect ${r.name} as ${r.user} -> ok (${Date.now() - started} ms)`);
            return json(200, r);
          }
          if (pathname === '/__sql/run' && post) {
            try {
              const r = await sq.run(b.session, b.sql, { fetch: b.fetch });
              log(`SQL ${r.kind} -> ok (${r.ms} ms)`);
              return json(200, r);
            } catch (e) {
              log(`SQL run -> ${String(e.message).split('\n')[0].slice(0, 120)}`);
              // A statement the database refused is an answer, not a failed call: its words go back as data.
              return json(200, { error: e.message, ms: e.ms || Date.now() - started });
            }
          }
          // Ask AI (lib/aiSql.js): the LLM the person chose, with their key, called from here; the page never holds a key.
          const ai = o.aiStore;
          if (pathname.startsWith('/__sql/ai/') && !ai) return json(200, { error: 'Ask AI is not set up in this app.' });
          if (pathname === '/__sql/ai/settings' && req.method === 'GET') return json(200, ai.settings());
          if (pathname === '/__sql/ai/settings' && post) return json(200, ai.save(b));
          if (pathname === '/__sql/ai/forget' && post) return json(200, ai.forget(b.provider));
          if (pathname === '/__sql/ai/models' && post) {
            const r = await ai.models(b.provider);
            log(`AI models ${b.provider} -> ${r.ok ? r.models.length + ' models' : 'failed'} (${r.ms} ms)`);
            return json(200, r);
          }
          if (pathname === '/__sql/ai/ask' && post) {
            try {
              const sc = b.session ? await sq.schema(b.session) : { owner: '', banner: '', tables: [] };
              const r = await ai.ask({ question: b.question, sql: b.sql, schema: sc, banner: sc.banner, provider: b.provider });
              log(`AI ask ${r.provider} ${r.model} -> ${r.sql ? 'SQL' : 'no SQL'} (${r.ms} ms, ${r.sent.tables} tables named)`);
              return json(200, r);
            } catch (e) {
              log(`AI ask -> ${String(e.message).slice(0, 160)}`);
              return json(200, { error: e.message });
            }
          }
          // A plain chat turn (no schema, no SQL parsing): EquipRite Next's Minutes page "Format by AI" posts { system, user }.
          if (pathname === '/__sql/ai/chat' && post) {
            try {
              const r = await ai.chat(b);
              log(`AI chat ${r.provider || ''} ${r.model || ''} -> ${r.ok ? (r.text || '').length + ' chars' : 'failed'} (${r.ms || 0} ms)`);
              return json(200, r);
            } catch (e) {
              log(`AI chat -> ${String(e.message).slice(0, 160)}`);
              return json(200, { ok: false, error: e.message });
            }
          }
          if (pathname === '/__sql/more' && post) return json(200, await sq.more(b.session, b.count));
          if (pathname === '/__sql/commit' && post) return json(200, await sq.commit(b.session));
          if (pathname === '/__sql/rollback' && post) return json(200, await sq.rollback(b.session));
          if (pathname === '/__sql/cancel' && post) return json(200, await sq.cancel(b.session));
          if (pathname === '/__sql/disconnect' && post) return json(200, await sq.disconnect(b.session));
          return json(404, { error: 'Not found' });
        })().catch((e) => json(200, { error: e.message }));
        return undefined;
      }
      if (pathname === '/__versions') {
        return send(res, 200, 'application/json', JSON.stringify((o.getVersions && o.getVersions()) || {}));
      }
      const b = /^\/__backend\/([^/]+)(\/.*)?$/.exec(pathname);
      if (b) {
        return proxy(req, res, decodeURIComponent(b[1]), b[2] || '', u.search);
      }
      if (/^\/(version_[^/]+\/)?services\/catalog\.json$/.test(pathname)) {
        return send(res, 200, 'application/json', JSON.stringify(loadCatalog(`http://${req.headers.host}`)));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed');
      }
      return serveFile(req, res, pathname);
    }).catch((e) => {
      log(`${req.method} ${pathname} -> ERROR ${e.message}`);
      if (!res.headersSent) {
        send(res, 500, 'application/json', JSON.stringify({ error: e.message }));
      } else {
        res.destroy();
      }
    });
  });

  return new Promise((resolve, reject) => {
    if (!fs.existsSync(path.join(webRoot, 'index.html'))) {
      reject(new Error(`No build in ${webRoot}. Run "npm run desktop:fresh" (or "npm run build") first.`));
      return;
    }
    server.once('error', (e) => reject(e.code === 'EADDRINUSE'
      ? new Error(`Port ${o.port} is already in use. Close the other EquipRite window, or set EQP_PORT to another port.`)
      : e));
    server.listen(o.port, o.host || '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, url: `http://localhost:${port}/`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/** True when `npm run build` has produced this web app (build/processed/webApps/<webApp>/index.html). */
function isBuilt(buildDir, webApp) {
  return fs.existsSync(path.join(buildDir, 'processed', 'webApps', webApp, 'index.html'));
}

/** Identity for `npm run serve`: EQP_USER, then EQP_ROLES (comma-separated) or EQP_FUSION_PASSWORD (+ EQP_FUSION_USER). */
function identityFromEnv(env) {
  const roles = String(env.EQP_ROLES || '').split(',').map((r) => r.trim().toUpperCase()).filter(Boolean);
  const password = env.EQP_FUSION_PASSWORD || '';
  return {
    username: env.EQP_USER || '',
    roles: roles.length ? roles : null,
    fusion: password ? { user: env.EQP_FUSION_USER || env.EQP_USER || '', password } : null,
  };
}

module.exports = {
  createDevServer,
  isBuilt,
  rewriteCatalog,
  fusionCredential,
  fillAppFlow,
  currentUser,
  rolesReportResponse,
  isRolesReport,
  reportName,
  backendOverridesFromEnv,
  identityFromEnv,
  safeFile,
  KNOWN_ROLES,
};

if (require.main === module) {
  const identity = identityFromEnv(process.env);
  const port = Number(process.env.EQP_PORT) || 8888;
  // EQP_WEBAPP=equiprite serves New EquipRite; the default is the old app. Its links to the old app stay disabled
  // here (no /__versions), since only one app runs.
  const webApp = process.env.EQP_WEBAPP || 'vbredwoodapp';
  createDevServer({
    buildDir: path.resolve(__dirname, '..', '..', 'build'),
    webApp,
    port,
    getIdentity: () => identity,
    backendOverrides: backendOverridesFromEnv(process.env),
    // the FDD library page uploads into this project (and commits it to git) when served this way too
    fddStore: webApp === 'equiprite-next' ? require('./fdd').open({ root: path.resolve(__dirname, '..', '..') }) : undefined,
    // the Application pages catalog (no screenshots captured this way: upload them, or use the desktop app)
    pagesStore: webApp === 'equiprite-next' ? require('./pages').open({ root: path.resolve(__dirname, '..', '..') }) : undefined,
    // saved AI analyses, in your home folder when served this way (the desktop app keeps them in its data folder)
    analysisStore: webApp === 'equiprite-next' ? require('./analyses').open({ file: path.join(require('os').homedir(), '.equiprite', 'ai-analyses.json') }) : undefined,
    onLog: (line) => console.log(line),
  }).then(({ url }) => {
    console.log(`\n${webApp === 'equiprite' ? 'New EquipRite' : 'EquipRite'} is running at ${url}  (Ctrl+C stops it)`);
    if (!identity.username) {
      console.log('Signed in as nobody, so the app shows "No Access". Set EQP_USER and EQP_ROLES (or EQP_FUSION_PASSWORD), e.g.');
      console.log('  PowerShell:  $env:EQP_USER="john.dunbar"; $env:EQP_ROLES="RT_EQP_MANAGER"; npm run serve');
    } else {
      console.log(`Signed in as ${identity.username}; roles ${identity.roles ? identity.roles.join(', ') : 'from Fusion (ROLES_RP)'}`);
    }
  }).catch((e) => {
    console.error(`\nserve: ${e.message}\n`);
    process.exit(1);
  });
}
