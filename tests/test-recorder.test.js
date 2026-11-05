/*
 * Record on a Jira story (Old and Next): the evidence store on this PC (desktop/lib/testEvidence.js), the desktop
 * server's /__rec/* (desktop/lib/devserver.js), the technical trace (desktop/lib/testTrace.js: the web service calls
 * with their JSON, console errors, secrets masked; HAR; the bug report), and the page's recorder kept identical in both apps
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
const TT = require(path.join(ROOT, 'desktop', 'lib', 'testTrace.js'));
const zlib = require('zlib');

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

T.section('the technical trace: secrets never kept');
const masked = JSON.parse(TT.redactText(JSON.stringify({ username: 'priya', password: 'p@ss', nested: { apiKey: 'k1', token: 't', nextPageToken: 'keep' }, rows: [{ Authorization: 'Basic x' }] })));
T.eq('JSON: password, apiKey, token, Authorization masked (nextPageToken kept)', [masked.username, masked.password, masked.nested.apiKey, masked.nested.token, masked.nested.nextPageToken, masked.rows[0].Authorization].join(),
  'priya,•••,•••,•••,keep,•••');
T.check('XML (SOAP): a password tag masked', TT.redactText('<v2:userID>priya</v2:userID><v2:password>secret1</v2:password>') === '<v2:userID>priya</v2:userID><v2:password>•••</v2:password>');
T.eq('a form: its password field masked', TT.redactText('user=a&password=b&x=1'), 'user=a&password=•••&x=1');
T.eq('headers: Authorization and cookies dropped, a token header masked, what every browser sends left out', JSON.stringify(TT.headersOf({ authorization: 'Basic eA==', cookie: 'a=b',
  'content-type': 'application/json', 'x-api-token': 'zz', 'user-agent': 'Mozilla/5.0', 'sec-ch-ua': '"Chromium"', 'accept-encoding': 'gzip', host: 'localhost:8890' })),
  '{"content-type":"application/json","x-api-token":"•••"}');
T.eq('a zipped answer, unzipped for the trace', TT.bodyText(zlib.gzipSync(Buffer.from('{"ok":true}')), { 'content-encoding': 'gzip', 'content-type': 'application/json' }), '{\n  "ok": true\n}');
T.eq('an image answer: noted, not kept', TT.bodyText(Buffer.alloc(10), { 'content-type': 'image/png' }), '[image/png, 10 bytes]');
T.check('a big answer: cut, saying so', /… cut: 300000 bytes in all$/.test(TT.bodyText(Buffer.alloc(300000, 65), { 'content-type': 'text/plain' })));
const ce = TT.consoleEntry([{ level: 'error', message: 'TypeError: x is undefined', lineNumber: 12, sourceId: 'http://localhost:8890/flows/a.js' }], 'http://localhost:8890/vp/shell/requests');
T.eq('a console error (Electron\'s event), its source and page on this PC', [ce.level, ce.message, ce.source, ce.line, ce.page].join(' | '), 'error | TypeError: x is undefined | /flows/a.js | 12 | /vp/shell/requests');
T.eq('…the older positional form (3 = error), and info left out', [TT.consoleEntry([{}, 3, 'boom', 1, 'a.js']).level, TT.consoleEntry([{ level: 'info', message: 'hi' }])].join(), 'error,');
const call = TT.callEntry({ t: 1000, app: 'Old', method: 'post', service: 'eqpt', path: '/equipmentRequests', url: 'http://user:pw@host/equipmentRequests?token=abc&x=1', status: 500, ms: 812 });
T.eq('a call: no login or token left in its URL; a 500 is a failure', [call.method, call.url, call.failed].join(' | '), 'POST | http://host/equipmentRequests?token=•••&x=1 | true');

T.section('the technical trace, kept with the recording');
clock = new Date(2026, 10, 5, 15, 0, 0);
const tr = store.start('EQP-196', 'webm', { trace: true });
T.check('a traced recording: the server is told to keep the calls', tr.trace && store.tracing());
store.chunk(tr.id, Buffer.from('video'));
store.traceAdd(TT.callEntry({ method: 'GET', service: 'eqpt', path: '/equipment', url: 'http://h/equipment', status: 200, ms: 40, resBody: '{"items":[]}' }));
store.traceAdd(TT.pageEntry('http://localhost:8890/vp/shell/requests/new'));
store.traceAdd(TT.callEntry({ method: 'POST', service: 'eqpt', path: '/equipmentRequests', url: 'http://h/equipmentRequests', status: 500, ms: 812,
  reqHeaders: { 'content-type': 'application/json' }, reqBody: TT.redactText('{"requestNumber":"R-1","password":"x"}'), resBody: '{"error":"ORA-00001: unique constraint"}' }));
store.traceAdd(TT.consoleEntry([{ level: 'error', message: 'Save failed' }], ''));
store.image('EQP-196', Buffer.from([137, 80, 78, 71]), 'png');
T.eq('its numbers as they happen (the bar)', JSON.stringify(store.status(tr.id)), '{"trace":true,"calls":2,"failed":1,"console":1,"errors":1}');
const done = store.finish(tr.id);
T.check('not traced once it stops', !store.tracing());
T.eq('the recording\'s item says what its trace holds, and where it broke', [done.trace.calls, done.trace.failed, done.trace.errors, done.trace.first.text, done.trace.url].join(' | '),
  '2 | 1 | 1 | POST eqpt /equipmentRequests → 500 | /__rec/trace/EQP-196/2026-11-05%2015-00-00%20recording.webm');
const full = store.trace('EQP-196', done.name);
T.eq('the timeline: calls, the page, the error, the screenshot, each with its moment in the video', full.entries.map((e) => e.kind).join(), 'call,page,call,console,shot');
T.check('…offsets from the start, never negative', full.entries.every((e) => typeof e.offset === 'number' && e.offset >= 0) && full.ended);
T.check('…what was sent, with the password masked', full.entries[2].reqBody.includes('"requestNumber": "R-1"') && full.entries[2].reqBody.includes('"password": "•••"'));
const har = store.har('EQP-196', done.name);
T.eq('as a HAR file: the two calls, the 500 with its answer', [har.log.version, har.log.entries.length, har.log.entries[1].response.status, har.log.entries[1].request.postData.mimeType,
  har.log.entries[1].response.content.text].join(' | '), '1.2 | 2 | 500 | application/json | {"error":"ORA-00001: unique constraint"}');
const rep = store.report('EQP-196', done.name);
T.check('the bug report: what failed, what was sent and answered, the console error, the pages', rep.includes('What failed') && rep.includes('POST http://h/equipmentRequests → 500 (812 ms)')
  && rep.includes('ORA-00001') && rep.includes('Console errors (1):') && rep.includes('Pages: /vp/shell/requests/new') && rep.includes('Calls: 2 (1 failed)'), rep);
const plain = store.start('EQP-196', 'webm');
store.chunk(plain.id, Buffer.from('v'));
T.check('a recording without the trace: no trace file, nothing kept for it', !plain.trace && !store.tracing() && store.traceAdd({ kind: 'page' }) === 0 && !store.finish(plain.id).trace);
store.remove('EQP-196', done.name);
T.check('removing a recording removes its trace', !fs.existsSync(path.join(dir, 'EQP-196', done.name)) && !fs.existsSync(path.join(dir, 'EQP-196', done.name.replace(/\.webm$/, '.trace.jsonl'))));

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

  T.section('the desktop server keeps each web service call while a traced recording runs');
  const fake = http.createServer((rq, rs) => {
    let b = '';
    rq.on('data', (c) => { b += c; });
    rq.on('end', () => {
      if (rq.method === 'POST') { rs.writeHead(500, { 'content-type': 'application/json' }); rs.end(JSON.stringify({ error: 'ORA-01400: cannot insert NULL', got: JSON.parse(b || '{}') })); return; }
      const z = zlib.gzipSync(Buffer.from(JSON.stringify({ items: [{ id: 7 }] })));
      rs.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      rs.end(z);
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const back = `http://127.0.0.1:${fake.address().port}`;
  fs.writeFileSync(path.join(build, 'processed', 'services', 'catalog.json'), JSON.stringify({ backends: {
    eqpt: { servers: [{ url: back, 'x-vb': { forceProxy: 'always', anonymousAccess: true } }] },
    jira: { servers: [{ url: back, 'x-vb': { forceProxy: 'always', anonymousAccess: true } }] } } }));
  fs.mkdirSync(path.join(build, 'processed', 'webApps', 'vbredwoodapp'), { recursive: true });
  fs.writeFileSync(path.join(build, 'processed', 'webApps', 'vbredwoodapp', 'index.html'), '<html>old</html>');
  const rs2 = TE.open({ dir: path.join(dir, 'srv2') });
  const srv2 = await DS.createDevServer({ buildDir: build, webApp: 'vbredwoodapp', repoRoot: ROOT, port: 0, getIdentity: () => ({ username: 'tester' }), recStore: rs2, onLog: () => {} });
  const req2 = (method, p, headers, body) => new Promise((resolve, reject) => {
    const q = http.request({ host: 'localhost', port: srv2.port, path: p, method, headers: headers || {} }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    q.on('error', reject);
    if (body) q.write(body);
    q.end();
  });
  try {
    await req2('GET', '/__backend/eqpt/equipment?limit=5');
    T.check('no recording: nothing kept', !rs2.tracing() && !fs.existsSync(path.join(dir, 'srv2')));
    const st = JSON.parse((await req2('POST', '/__rec/start?key=EQP-12&ext=webm&trace=1', W)).body);
    const got = await req2('GET', '/__backend/eqpt/equipment?limit=5', { authorization: 'Basic c2VjcmV0', cookie: 'JSESSIONID=1' });
    T.check('the page still gets its answer, untouched (zipped as the backend sent it)', got.status === 200 && got.headers['content-encoding'] === 'gzip'
      && JSON.parse(zlib.gunzipSync(got.body)).items[0].id === 7);
    await req2('POST', '/__backend/eqpt/equipmentRequests', { 'content-type': 'application/json' }, JSON.stringify({ requestNumber: 'R-9', password: 'nope' }));
    await req2('GET', '/__backend/jira/rest/api/2/myself');
    const live = JSON.parse((await req2('GET', '/__rec/status?id=' + st.id)).body);
    T.eq('the bar\'s numbers: 2 calls, 1 failed (Jira\'s own call not counted: the test tool, not the app)', [live.calls, live.failed].join(), '2,1');
    await req2('POST', '/__rec/chunk?id=' + st.id, Object.assign({ 'content-type': 'application/octet-stream' }, W), Buffer.from('video'));
    const fin = JSON.parse((await req2('POST', '/__rec/finish?id=' + st.id + '&key=EQP-12', W)).body).item;
    const t2 = JSON.parse((await req2('GET', fin.trace.url)).body);
    const [g, pst] = t2.entries;
    T.eq('the calls, as Old made them: method, service, path, status', t2.entries.map((e) => [e.app, e.method, e.service, e.path, e.status].join(' ')).join(' | '),
      'Old GET eqpt /equipment?limit=5 200 | Old POST eqpt /equipmentRequests 500');
    T.check('…the answer unzipped and readable; the login and cookie never kept', g.resBody.includes('"id": 7') && !JSON.stringify(t2).includes('c2VjcmV0') && !JSON.stringify(t2).includes('JSESSIONID'));
    T.check('…what was sent (password masked) and what came back', pst.reqBody.includes('"requestNumber": "R-9"') && pst.reqBody.includes('•••') && !pst.reqBody.includes('nope')
      && pst.resBody.includes('ORA-01400') && pst.failed);
    const harRes = await req2('GET', fin.trace.har);
    T.check('the HAR file, to download', harRes.headers['content-disposition'] === 'attachment; filename="EQP-12 ' + fin.name.replace(/\.webm$/, '') + '.har"'
      && JSON.parse(harRes.body).log.entries.length === 2);
    const repRes = await req2('GET', '/__rec/report/EQP-12/' + encodeURIComponent(fin.name));
    T.check('the bug report, as text', repRes.headers['content-type'].startsWith('text/plain') && repRes.body.toString().includes('ORA-01400'));
  } finally {
    await srv2.close();
    fake.close();
  }
  T.report();
})();
