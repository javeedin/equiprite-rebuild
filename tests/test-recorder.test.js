/*
 * Record on a Jira story (Old and Next): the evidence store on this PC (desktop/lib/testEvidence.js), the desktop
 * server's /__rec/* (desktop/lib/devserver.js), and the page's recorder kept identical in both apps
 * (resources/js/testRecorder.js). The recording itself (the picker, the bar, MediaRecorder) runs in a real browser in
 * tests/e2e/next-jira.e2e.js.
 *
 * Run:  node tests/test-recorder.test.js
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const H = require('./_harness');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const TE = require(path.join(ROOT, 'desktop', 'lib', 'testEvidence.js'));
const DS = require(path.join(ROOT, 'desktop', 'lib', 'devserver.js'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-evidence-'));
let clock = new Date(2026, 10, 5, 14, 3, 21);
const revealed = [];
const store = TE.open({ dir, now: () => clock, reveal: (f) => revealed.push(f) });

T.section('the store: a folder per story, a recording written as it is made');
const r = store.start('EQP-196', 'mp4');
T.eq('a recording begun, named by when', r.name, '2026-11-05 14-03-21 recording.mp4');
store.chunk(r.id, Buffer.from('first seconds '));
store.chunk(r.id, Buffer.from('next seconds'));
T.check('…not listed while it is being made', store.list('EQP-196').items.length === 0);
const item = store.finish(r.id);
T.eq('closed: in the story\'s folder, its size and link', [item.name, item.kind, item.size, item.url].join(' | '),
  '2026-11-05 14-03-21 recording.mp4 | video | 26 | /__rec/file/EQP-196/2026-11-05%2014-03-21%20recording.mp4');
T.eq('…on disk', fs.readFileSync(path.join(dir, 'EQP-196', item.name), 'utf8'), 'first seconds next seconds');
clock = new Date(2026, 10, 5, 14, 4, 2);
const shot = store.image('EQP-196', Buffer.from([137, 80, 78, 71]), 'png');
const shot2 = store.image('EQP-196', Buffer.from([137, 80, 78, 71]), 'png');
T.eq('screenshots, never overwritten', [shot.name, shot2.name].join(' | '), '2026-11-05 14-04-02 screenshot.png | 2026-11-05 14-04-02 screenshot (2).png');
T.eq('the story\'s evidence, newest first', store.list('EQP-196').items.map((x) => x.kind + ' ' + x.name).join(' | '),
  'image 2026-11-05 14-04-02 screenshot.png | image 2026-11-05 14-04-02 screenshot (2).png | video 2026-11-05 14-03-21 recording.mp4');
T.check('another story has its own (empty) folder', store.list('EQP-12').items.length === 0);
const empty = store.start('EQP-12');
T.eq('a recording with nothing in it is not kept', [store.finish(empty.id), fs.readdirSync(path.join(dir, 'EQP-12')).length].join(), ',0');
let threw = '';
try { store.start('../../etc'); } catch (e) { threw = e.message; }
T.eq('only a Jira key names a folder', threw, 'Not a Jira key: ../../etc');
T.eq('only a file of that story\'s folder is served', [store.file('EQP-196', '../EQP-12/x.png'), store.file('EQP-196', 'nope.png'), path.basename(store.file('EQP-196', shot.name))].join('|'),
  '||2026-11-05 14-04-02 screenshot.png');
store.reveal('EQP-196');
T.eq('Open folder', revealed[0], path.join(dir, 'EQP-196'));

T.section('the page\'s recorder is the same file in Old and Next');
const next = path.join(ROOT, 'webApps', 'equiprite-next', 'resources', 'js', 'testRecorder.js');
const old = path.join(ROOT, 'webApps', 'vbredwoodapp', 'resources', 'js', 'testRecorder.js');
T.check('webApps/vbredwoodapp/resources/js/testRecorder.js is identical', fs.existsSync(old) && fs.readFileSync(old, 'utf8') === fs.readFileSync(next, 'utf8'));
const src = fs.readFileSync(next, 'utf8');
T.check('it records in pieces (MediaRecorder timeslice) and prefers MP4', /recorder\.start\(CHUNK_MS\)/.test(src) && /'video\/mp4;codecs=avc1'/.test(src.split('\n').find((l) => l.includes('MIMES')) || ''));

(async () => {
  T.section('the desktop server: /__rec/* to this PC, writes only from the page');
  const build = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-build-'));
  const web = path.join(build, 'processed', 'webApps', 'equiprite-next');
  fs.mkdirSync(path.join(web, 'version_1'), { recursive: true });
  fs.mkdirSync(path.join(build, 'processed', 'services'), { recursive: true });
  fs.writeFileSync(path.join(web, 'index.html'), '<html>next</html>');
  fs.writeFileSync(path.join(build, 'processed', 'services', 'catalog.json'), '{"backends":{}}');
  const srv = await DS.createDevServer({ buildDir: build, webApp: 'equiprite-next', repoRoot: ROOT, port: 0, getIdentity: () => ({ username: 'tester' }),
    recStore: TE.open({ dir: path.join(dir, 'srv'), reveal: (f) => revealed.push(f) }), onLog: () => {} });
  const req = (method, p, headers, body) => new Promise((resolve, reject) => {
    const q = http.request({ host: 'localhost', port: srv.port, path: p, method, headers: headers || {} }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    q.on('error', reject);
    if (body) q.write(body);
    q.end();
  });
  const W = { 'x-equiprite-rec': '1' };
  const j = (x) => JSON.parse(x.body.toString('utf8'));
  try {
    T.eq('info', j(await req('GET', '/__rec/info')).available, true);
    T.eq('a write without the page\'s header: refused', (await req('POST', '/__rec/start?key=EQP-196')).status, 403);
    T.eq('…from another site: refused', (await req('POST', '/__rec/start?key=EQP-196', Object.assign({ origin: 'https://evil.example.com' }, W))).status, 403);
    const st = j(await req('POST', '/__rec/start?key=EQP-196&ext=webm', W));
    const video = Buffer.alloc(5000, 7);
    await req('POST', '/__rec/chunk?id=' + st.id, Object.assign({ 'content-type': 'application/octet-stream' }, W), video.subarray(0, 3000));
    await req('POST', '/__rec/chunk?id=' + st.id, Object.assign({ 'content-type': 'application/octet-stream' }, W), video.subarray(3000));
    const fin = j(await req('POST', '/__rec/finish?id=' + st.id + '&key=EQP-196', W)).item;
    T.eq('a recording sent in pieces, saved whole', [fin.kind, fin.size].join(' '), 'video 5000');
    const img = j(await req('POST', '/__rec/image?key=EQP-196&ext=png', Object.assign({ 'content-type': 'image/png' }, W), Buffer.from([137, 80, 78, 71, 13, 10]))).item;
    T.eq('a screenshot', img.kind, 'image');
    T.eq('the story\'s list', j(await req('GET', '/__rec/list?key=EQP-196')).items.map((x) => x.kind).join(), 'image,video');
    const whole = await req('GET', fin.url);
    T.eq('the video, for the player', [whole.status, whole.headers['content-type'], whole.headers['accept-ranges'], whole.body.length].join(' '), '200 video/webm bytes 5000');
    const part = await req('GET', fin.url, { range: 'bytes=1000-1999' });
    T.eq('…a range, so it can seek', [part.status, part.headers['content-range'], part.body.length].join(' '), '206 bytes 1000-1999/5000 1000');
    T.eq('the screenshot', (await req('GET', img.url)).headers['content-type'], 'image/png');
    T.eq('nothing outside the story\'s folder', (await req('GET', '/__rec/file/EQP-196/..%2F..%2Fsecret.png')).status, 404);
    j(await req('POST', '/__rec/reveal?key=EQP-196', W));
    T.check('Open folder', revealed[revealed.length - 1] === path.join(dir, 'srv', 'EQP-196'));
  } finally {
    await srv.close();
  }
  T.report();
})();
