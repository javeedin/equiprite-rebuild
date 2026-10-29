/*
 * The desktop client's local server (desktop/lib/devserver.js) and its sign-in rules (desktop/lib/identity.js).
 *
 * Until 2026-10-29 the desktop window ran Oracle's `grunt vb-serve`, which only serves files: VB got no user
 * (the build leaves "%{env.userProfileUrl}%" in app-flow.json), no services catalog (it sits in
 * build/processed/services/) and no proxy, so every local run landed on "You don't have access to EquipRite"
 * with no data. The local server fills those gaps the way the VBCS server does.
 *
 * The roles answer is checked with the REAL resources/js/bipLov.js the app parses ROLES_RP with, and the server
 * is run for real against a stand-in backend.
 *
 * Run:  node tests/desktop-devserver.test.js
 */
'use strict';

const fs   = require('fs');
const http = require('http');
const os   = require('os');
const path = require('path');
const vm   = require('vm');
const H    = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const DS = require(path.join(ROOT, 'desktop', 'lib', 'devserver.js'));
const ID = require(path.join(ROOT, 'desktop', 'lib', 'identity.js'));

/** The shipped bipLov.js (AMD, no dependencies). */
function loadBipLov() {
  const src = fs.readFileSync(path.join(H.APP, 'resources', 'js', 'bipLov.js'), 'utf8');
  const sandbox = { console, atob: (s) => Buffer.from(s, 'base64').toString('binary') };
  let mod;
  sandbox.define = (deps, factory) => { mod = factory(); };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'bipLov.js' });
  return mod;
}

// ── catalog ──────────────────────────────────────────────────────────

T.section('catalog — every backend through this server, nothing through VBCS');
const realCatalog = H.readJson(path.join(H.SERVICES, 'catalog.json'));
const { catalog, backends } = DS.rewriteCatalog(realCatalog, 'http://localhost:18888');
const servers = Object.keys(catalog.backends).map((n) => [n, catalog.backends[n].servers[0]]);
T.check('every backend points at /__backend/<name>',
  servers.every(([n, s]) => s.url === `http://localhost:18888/__backend/${n}`));
T.check('no forceProxy left', servers.every(([, s]) => !s['x-vb'].forceProxy));
T.check('no VBCS credential reference left', servers.every(([, s]) => !s['x-vb'].authentication));
T.eq('eqpt keeps its real URL for forwarding', backends.eqpt.url, 'http://132.145.153.37:8087');
T.eq('eqpt is anonymous', backends.eqpt.basic, false);
T.check('the Fusion credential is the one bipService and fusion share',
  DS.fusionCredential(backends) === backends.bipService.credentials && backends.fusion.credentials === backends.bipService.credentials);
T.check('OIC has its own credential (a Fusion login is not sent there)',
  backends.ics.basic && backends.ics.credentials !== DS.fusionCredential(backends));
T.check('the source catalog is not modified',
  realCatalog.backends.eqpt.servers[0]['x-vb'].forceProxy === 'always');

// ── user ─────────────────────────────────────────────────────────────

T.section('user — what VB reads from /_currentuser');
T.eq('profile URL placeholder filled',
  DS.fillAppFlow('{"url": "%{env.userProfileUrl}%", "oauthUrl": "%{env.oauthUserProfileUrl}%"}'),
  '{"url": "/_currentuser", "oauthUrl": ""}');
const user = DS.currentUser({ username: 'john.dunbar' });
T.eq('isAnonymous is exactly false (VB ignores the user otherwise)', user.isAnonymous, false);
T.eq('userName carries the username', user.userName, 'john.dunbar');
T.eq('no identity -> anonymous', DS.currentUser(null).isAnonymous, true);

// ── roles ────────────────────────────────────────────────────────────

T.section('roles — ROLES_RP answered locally, read by the shipped bipLov.js');
const bipLov = loadBipLov();
const soap = DS.rolesReportResponse('john.dunbar', ['RT_EQP_MANAGER', 'RT_EQP_TIMEKEEPER']);
const bytes = bipLov.extractReportBytes(soap);
T.check('bipLov finds reportBytes in the answer', !!bytes);
const xml = Buffer.from(bytes, 'base64').toString('utf8');
T.check('one G_1 row per role, code in ORACLE_ROLE_COMMON_NAME',
  (xml.match(/<G_1>/g) || []).length === 2
  && /<ORACLE_ROLE_COMMON_NAME>RT_EQP_MANAGER<\/ORACLE_ROLE_COMMON_NAME>/.test(xml)
  && /<ORACLE_ROLE_COMMON_NAME>RT_EQP_TIMEKEEPER<\/ORACLE_ROLE_COMMON_NAME>/.test(xml));
T.check('names are XML-escaped', /a&lt;b/.test(Buffer.from(bipLov.extractReportBytes(DS.rolesReportResponse('a<b', ['X'])), 'base64').toString()));
const rolesBody = bipLov.buildSoapBody('/Custom/EquipRite/ROLES_RP.xdo', [{ name: 'P_LOGIN', value: 'john.dunbar' }]);
T.eq('the app\'s own ROLES_RP request is recognised', DS.isRolesReport(rolesBody), true);
T.eq('another BIP report is not', DS.isRolesReport(bipLov.buildSoapBody('/Custom/EquipRite/PROJECTS_RP.xdo', [])), false);

// ── sign-in rules ────────────────────────────────────────────────────

T.section('sign-in — what the form accepts');
T.check('username required', !!ID.validate({ rolesFrom: 'pick', roles: ['RT_EQP_MANAGER'] }).error);
T.check('roles from Fusion needs a password', !!ID.validate({ username: 'u', rolesFrom: 'fusion' }).error);
T.check('picking needs a role', !!ID.validate({ username: 'u', rolesFrom: 'pick' }).error);
const picked = ID.validate({ username: ' john.dunbar ', rolesFrom: 'pick', roles: ['RT_EQP_MANAGER'], otherRoles: 'oii_rt_eqp_manager_jr, RT_EQP_MANAGER' });
T.eq('picked + other roles, upper-cased, de-duplicated', picked.saved.roles.join(','), 'RT_EQP_MANAGER,OII_RT_EQP_MANAGER_JR');
T.eq('username trimmed', picked.saved.username, 'john.dunbar');
const prev = { username: 'u', fusionUser: 'u', fusionPassword: 'ENC' };
T.check('a saved password is kept when the field is left empty', !ID.validate({ username: 'u', rolesFrom: 'fusion' }, prev).error);
T.check('…but not for a different Fusion user', !!ID.validate({ username: 'u', fusionUser: 'other', rolesFrom: 'fusion' }, prev).error);

T.section('sign-in — the password is never written in clear');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-id-'));
const file = path.join(tmp, 'local-identity.json');
const enc = (s) => Buffer.from(`enc:${s}`);
const dec = (b) => b.toString().replace(/^enc:/, '');
const v = ID.validate({ username: 'john.dunbar', rolesFrom: 'fusion', fusionPassword: 's3cret!' });
ID.save(file, v.saved, v.password, enc, null);
T.check('file has no clear password', fs.readFileSync(file, 'utf8').indexOf('s3cret!') < 0);
const back = ID.toServerIdentity(ID.load(file), null, dec);
T.eq('decrypts for the server', back.fusion && back.fusion.password, 's3cret!');
T.eq('roles from Fusion -> no local roles', back.roles, null);
ID.save(file, v.saved, v.password, null, null);
T.check('without encryption nothing is saved for the password', !('fusionPassword' in ID.load(file)));
fs.rmSync(tmp, { recursive: true, force: true });

// ── web services catalog (View → Web services…) ──────────────────────

T.section('web services — every endpoint, its parameters and its callers');
const CAT = require(path.join(ROOT, 'desktop', 'lib', 'catalog.js'));
const ws = CAT.buildCatalog(ROOT);
const opIds = (svc) => Object.keys(H.readJson(path.join(H.SERVICES, svc, 'openapi3.json')).paths)
  .reduce((n, p) => n + Object.keys(H.readJson(path.join(H.SERVICES, svc, 'openapi3.json')).paths[p])
    .filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).length, 0);
T.eq('one row per operation in services/', ws.rows.length, ws.services.reduce((n, s) => n + opIds(s.name), 0));
const pageAccess = ws.rows.find((r) => r.o === 'getRbacPageAccess');
T.check('query parameter read (oracleRole, required)',
  !!pageAccess && pageAccess.params.some((p) => p.name === 'oracleRole' && p.in === 'query' && p.required));
T.check('callers found (chains/loadPageAccessChain.js)', !!pageAccess && pageAccess.f.includes('chains/loadPageAccessChain.js'));
const currentQuote = ws.rows.find((r) => r.o === 'getCurrentQuote');
T.check('path parameter from the path template', !!currentQuote && currentQuote.params.some((p) => p.name === 'requestId' && p.in === 'path'));
const lov = ws.rows.find((r) => r.s === 'ProjectLOV' && /projectsLOV$/.test(r.p));
T.eq('VB default value pre-filled (x-vb defaultValue)', lov && (lov.params.find((p) => p.name === 'limit') || {}).example, '10000');
T.eq('eqp-v1 is anonymous', ws.services.find((s) => s.name === 'eqp-v1').auth, 'anon');
T.eq('ProjectLOV uses the Fusion credential', ws.services.find((s) => s.name === 'ProjectLOV').auth, 'fusion');
T.eq('ics has its own credential', ws.services.find((s) => s.name === 'ics').auth, 'other');
T.eq('double-encoded dash repaired', CAT.fixMojibake('a â€” b'), 'a — b');
T.eq('ordinary accents left alone', CAT.fixMojibake('Ångström café'), 'Ångström café');
T.check('no garbled text left in the catalog', !ws.rows.some((r) => /â€/.test(r.d + r.t)));

// ── the server, for real ─────────────────────────────────────────────

function get(port, p, opts) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: (opts && opts.method) || 'GET',
      headers: Object.assign({ host: `localhost:${port}` }, (opts && opts.headers) || {}) }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end(opts && opts.body);
  });
}

(async () => {
  T.section('server — files, user, catalog and forwarding');
  const seen = [];
  const backend = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization || '', body: b });
      res.writeHead(401, { 'www-authenticate': 'Basic realm="x"', 'content-type': 'application/json' });
      res.end('{"seen":true}');
    });
  });
  await new Promise((r) => backend.listen(0, '127.0.0.1', r));
  const fake = `http://127.0.0.1:${backend.address().port}`;

  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-build-'));
  const web = path.join(build, 'processed', 'webApps', 'vbredwoodapp');
  fs.mkdirSync(path.join(web, 'version_1'), { recursive: true });
  fs.mkdirSync(path.join(build, 'processed', 'services'), { recursive: true });
  fs.writeFileSync(path.join(web, 'index.html'), '<html>shell</html>');
  fs.writeFileSync(path.join(web, 'version_1', 'app-flow.json'), '{"url":"%{env.userProfileUrl}%"}');
  fs.writeFileSync(path.join(build, 'processed', 'secret.txt'), 'outside the web root');
  fs.writeFileSync(path.join(build, 'processed', 'services', 'catalog.json'), JSON.stringify(realCatalog));

  let identity = { username: 'john.dunbar', roles: ['RT_EQP_MANAGER'], fusion: { user: 'tech.user', password: 'pw' } };
  const problems = [];
  const logs = [];
  const srv = await DS.createDevServer({
    buildDir: build, repoRoot: ROOT, port: 0, getIdentity: () => identity,
    backendOverrides: { eqpt: fake, bipservice: fake, fusion: fake, ics: fake },
    onProblem: (p) => problems.push(p),
    onLog: (l) => logs.push(l),
  });
  const P = srv.port;
  try {
    T.eq('/ serves the app', (await get(P, '/')).body, '<html>shell</html>');
    T.eq('a deep route gets the app shell (router "path")', (await get(P, '/vp/shell/setup')).body, '<html>shell</html>');
    T.eq('a missing asset is a 404', (await get(P, '/nope.js')).status, 404);
    T.check('cannot read outside the web root', (await get(P, '/../../secret.txt')).body.indexOf('outside') < 0
      && (await get(P, '/%2e%2e/%2e%2e/secret.txt')).body.indexOf('outside') < 0);
    T.eq('app-flow.json gets the profile URL', (await get(P, '/version_1/app-flow.json')).body, '{"url":"/_currentuser"}');
    T.eq('/_currentuser is the local identity', JSON.parse((await get(P, '/_currentuser')).body).userName, 'john.dunbar');
    const cat = JSON.parse((await get(P, '/version_1/services/catalog.json')).body);
    T.eq('catalog served next to the web app, on the page\'s own origin', cat.backends.eqpt.servers[0].url, `http://localhost:${P}/__backend/eqpt`);

    await get(P, '/__backend/eqpt/equiprite/v1/rbac/page-access?oracleRole=RT_EQP_MANAGER');
    T.eq('eqpt: path and query forwarded', seen[0] && seen[0].url, '/equiprite/v1/rbac/page-access?oracleRole=RT_EQP_MANAGER');
    T.eq('eqpt: no credentials sent (anonymous, as in VBCS)', seen[0] && seen[0].auth, '');

    const roles = await get(P, '/__backend/bipService/xmlpserver/services/ExternalReportWSSService', { method: 'POST', body: rolesBody });
    T.eq('picked roles: ROLES_RP answered here, not forwarded', seen.length, 1);
    T.check('…with those roles', /reportBytes/.test(roles.body));

    await get(P, '/__backend/fusion/fscmRestApi/resources/x', {});
    T.eq('fusion: the Fusion login as basic auth', seen[1] && seen[1].auth, `Basic ${Buffer.from('tech.user:pw').toString('base64')}`);
    const r401 = await get(P, '/__backend/ics/ic/api/x');
    T.eq('ics: the Fusion login is not sent to OIC', seen[2] && seen[2].auth, '');
    T.eq('a 401 challenge is not passed on (no browser login box)', r401.headers['www-authenticate'], undefined);

    identity = { username: 'john.dunbar', roles: null, fusion: { user: 'tech.user', password: 'pw' } };
    await get(P, '/__backend/bipService/xmlpserver/services/ExternalReportWSSService', { method: 'POST', body: rolesBody });
    T.check('roles from Fusion: ROLES_RP goes to Fusion with the login',
      !!seen[3] && /ROLES_RP/.test(seen[3].body) && seen[3].auth.startsWith('Basic '));

    T.section('server — refused Fusion calls are reported, not left as silently empty lists');
    T.check('a refused Fusion login is reported', problems.some((p) => p.kind === 'refused' && p.backend === 'fusion'));
    T.check('OIC 401 is expected locally and not reported', !problems.some((p) => p.backend === 'ics'));
    identity = { username: 'john.dunbar', roles: ['RT_EQP_MANAGER'], fusion: null };
    problems.length = 0;
    const customers = bipLov.buildSoapBody('/Custom/EquipRite/EQP_CUSTOMERS_LOV_RP.xdo', [{ name: 'P_SEARCH', value: '' }, { name: 'P_SEARCH_BY', value: 'ALL' }]);
    await get(P, '/__backend/bipService/xmlpserver/services/ExternalReportWSSService', { method: 'POST', body: customers });
    T.check('customers report without a Fusion login -> "no-login", naming the report',
      problems.length === 1 && problems[0].kind === 'no-login' && problems[0].report === 'EQP_CUSTOMERS_LOV_RP');
    T.check('the backend-calls log names the report and the fix',
      logs.some((l) => /bipService EQP_CUSTOMERS_LOV_RP -> 401 .*no Fusion login: File > Sign in as/.test(l)));
    T.eq('report name read from the request', DS.reportName(customers), 'EQP_CUSTOMERS_LOV_RP');

    const page = await get(P, '/__services/');
    T.check('web services page served', page.status === 200 && /web-services\.js/.test(page.body));
    T.eq('its script served', (await get(P, '/__services/web-services.js')).status, 200);
    const wsData = await get(P, '/__services/data.json');
    const wsJson = JSON.parse(wsData.body);
    T.check('catalog data served with the signed-in user', wsJson.rows.length > 0 && wsJson.identity.username === 'john.dunbar');
    T.check('…and never the password', wsJson.identity.hasFusionLogin === false && wsData.body.indexOf('"pw"') < 0);

    backend.close();
    const down = await get(P, '/__backend/eqpt/x');
    T.check('backend down -> 502 that names the backend', down.status === 502 && /eqpt/.test(down.body));
    T.check('…and reported as unreachable', problems.some((p) => p.kind === 'unreachable' && p.backend === 'eqpt'));
  } catch (e) {
    T.check('server run', false, e.stack);
  } finally {
    await srv.close();
    backend.close();
    fs.rmSync(build, { recursive: true, force: true });
  }
  T.report();
})();
