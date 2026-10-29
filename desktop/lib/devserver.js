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
const { buildCatalog } = require('./catalog');

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
 */
function createDevServer(o) {
  const processed = path.join(o.buildDir, 'processed');
  const webRoot = path.join(processed, 'webApps', o.webApp || 'vbredwoodapp');
  const catalogFile = path.join(processed, 'services', 'catalog.json');
  const repoRoot = o.repoRoot || path.dirname(o.buildDir);
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

    const base = overrides[name.toLowerCase()] || backend.url;
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

    await new Promise((resolve) => {
      const mod = target.protocol === 'https:' ? https : http;
      const preq = mod.request(target, { method: req.method, headers, timeout: BACKEND_TIMEOUT_MS }, (pres) => {
        const out = Object.assign({}, pres.headers);
        // A 401 challenge would make the window pop a browser login box; the app handles the 401 itself.
        ['www-authenticate', 'set-cookie', ...HOP_BY_HOP].forEach((h) => delete out[h]);
        res.writeHead(pres.statusCode || 502, out);
        pres.pipe(res);
        pres.on('end', () => {
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
    server.listen(o.port, '127.0.0.1', () => {
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
