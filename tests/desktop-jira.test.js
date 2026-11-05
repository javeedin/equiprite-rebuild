/*
 * Connect Jira in the desktop app (desktop/lib/jiraAuth.js, served by desktop/lib/devserver.js at /__jira/*), for the
 * Jira stories page in Old and Next: the site, email and API token kept on this PC with the token encrypted and never
 * sent back to the page; /__jira/* only for this PC's own page (the X-EquipRite-Jira header); the token added only to
 * calls to the jira backend (/__backend/jira), never to another backend.
 *
 * Run:  node tests/desktop-jira.test.js
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const DS = require(path.join(ROOT, 'desktop', 'lib', 'devserver.js'));
const JA = require(path.join(ROOT, 'desktop', 'lib', 'jiraAuth.js'));

const enc = (t) => Buffer.from('enc:' + Buffer.from(t).toString('base64'));
const dec = (b) => Buffer.from(String(b).replace(/^enc:/, ''), 'base64').toString();

T.section('the store');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-jira-'));
const file = path.join(dir, 'jira-connection.json');
const store = JA.open({ file, encrypt: enc, decrypt: dec });
T.eq('not connected at first, on the EquipRite site', JSON.stringify(store.settings()), JSON.stringify({ site: 'https://equiprite.atlassian.net', email: '', hasToken: false, connected: false, keychain: true }));
T.eq('a site from a word, a host or a URL', ['equiprite', 'equiprite.atlassian.net', 'https://Equiprite.atlassian.net/jira/software'].map(JA.normaliseSite).join(' '),
  'https://equiprite.atlassian.net https://equiprite.atlassian.net https://equiprite.atlassian.net');
T.eq('…not another host', JA.normaliseSite('https://evil.example.com'), '');
let threw = '';
try { store.save({ site: 'equiprite', email: 'not-an-email', token: 'x' }); } catch (e) { threw = e.message; }
T.eq('an email is needed', threw, 'Enter the email you sign in to Jira with.');
const s1 = store.save({ site: 'equiprite', email: 'javeed@equiprite.com', token: 'ATATT-secret-1' });
T.check('saved: connected, and the token never comes back', s1.connected && s1.hasToken && JSON.stringify(s1).indexOf('ATATT') === -1);
T.check('…kept encrypted on disk', fs.readFileSync(file, 'utf8').indexOf('ATATT') === -1);
T.eq('…the proxy\'s header', store.auth().header, 'Basic ' + Buffer.from('javeed@equiprite.com:ATATT-secret-1').toString('base64'));
store.save({ site: 'equiprite', email: 'javeed@equiprite.com', token: '' });
T.check('an empty token keeps the saved one', store.auth().header.endsWith(Buffer.from('javeed@equiprite.com:ATATT-secret-1').toString('base64')));
T.check('read back by a new run', JA.open({ file, encrypt: enc, decrypt: dec }).settings().connected);
const noKeychain = JA.open({ file: path.join(dir, 'nk.json'), encrypt: null, decrypt: null });
noKeychain.save({ email: 'a@b.co', token: 'T1' });
T.check('without a keychain: this run only, nothing on disk', noKeychain.auth() && fs.readFileSync(path.join(dir, 'nk.json'), 'utf8').indexOf('T1') === -1
  && !JA.open({ file: path.join(dir, 'nk.json') }).settings().hasToken);

(async () => {
  T.section('the server: /__jira/* and the jira backend');
  const seen = [];
  const backend = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization || '' });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"displayName":"Javeed"}');
  });
  await new Promise((r) => backend.listen(0, '127.0.0.1', r));
  const fake = `http://127.0.0.1:${backend.address().port}`;
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-build-'));
  const web = path.join(build, 'processed', 'webApps', 'equiprite-next');
  fs.mkdirSync(path.join(web, 'version_1'), { recursive: true });
  fs.mkdirSync(path.join(build, 'processed', 'services'), { recursive: true });
  fs.writeFileSync(path.join(web, 'index.html'), '<html>next</html>');
  fs.writeFileSync(path.join(build, 'processed', 'services', 'catalog.json'), fs.readFileSync(path.join(ROOT, 'services', 'catalog.json')));
  const live = JA.open({ file: path.join(dir, 'live.json'), encrypt: enc, decrypt: dec });
  const srv = await DS.createDevServer({ buildDir: build, webApp: 'equiprite-next', repoRoot: ROOT, port: 0, getIdentity: () => ({ username: 'javeed' }),
    backendOverrides: { jira: fake, eqpt: fake }, jiraStore: live, onLog: () => {} });
  const req = (method, p, headers, body) => new Promise((resolve, reject) => {
    const r = http.request({ host: 'localhost', port: srv.port, path: p, method, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
  const H1 = { 'x-equiprite-jira': '1' };
  try {
    T.eq('without the page\'s header: refused', (await req('GET', '/__jira/settings')).status, 403);
    T.eq('from another site: refused', (await req('GET', '/__jira/settings', Object.assign({ origin: 'https://evil.example.com' }, H1))).status, 403);
    T.check('the page reads the connection (no token)', JSON.parse((await req('GET', '/__jira/settings', H1)).body).connected === false);
    const saved = JSON.parse((await req('POST', '/__jira/settings', H1, { site: 'equiprite', email: 'javeed@equiprite.com', token: 'ATATT-2' })).body);
    T.check('Connect Jira: saved, and the token is not in the answer', saved.connected && JSON.stringify(saved).indexOf('ATATT') === -1);
    T.eq('…a bad one says why', JSON.parse((await req('POST', '/__jira/settings', H1, { site: 'evil.example.com', email: 'a@b.co' })).body).error,
      'That is not a Jira Cloud address (https://<your-site>.atlassian.net).');
    await req('GET', '/__backend/jira/rest/api/2/myself');
    await req('GET', '/__backend/eqpt/equiprite/v1/rate-schedules');
    T.eq('the jira backend gets the token; another backend never does', seen.map((x) => x.url.split('?')[0] + ' ' + (x.auth ? 'Basic' : 'none')).join(' | '),
      '/rest/api/2/myself Basic | /equiprite/v1/rate-schedules none');
    T.eq('…the right one', seen[0].auth, 'Basic ' + Buffer.from('javeed@equiprite.com:ATATT-2').toString('base64'));
    const gone = JSON.parse((await req('POST', '/__jira/forget', H1, {})).body);
    seen.length = 0;
    await req('GET', '/__backend/jira/rest/api/2/myself');
    T.check('Disconnect: forgotten, and calls go without it', !gone.connected && seen[0].auth === '');
  } finally {
    await srv.close();
    backend.close();
  }
  T.report();
})();
