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
const TX = require(path.join(ROOT, 'desktop', 'lib', 'transcribe.js'));
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

T.section('the trace keeps WHETHER a call was authenticated, and AS WHOM — never the secret');
const basicHdr = 'Basic ' + Buffer.from('priya.raman:S3cret!value').toString('base64');
T.eq('Basic: the scheme and the username only', JSON.stringify(TT.authOf({ authorization: basicHdr })), '{"sent":true,"scheme":"Basic","user":"priya.raman"}');
T.eq('Bearer: the scheme, no user', JSON.stringify(TT.authOf({ authorization: 'Bearer ey.jwt.token' })), '{"sent":true,"scheme":"Bearer","user":""}');
T.eq('none: nothing sent', JSON.stringify(TT.authOf({})), '{"sent":false,"scheme":"","user":""}');
T.check('the password is never in the auth, however it is stringified', !JSON.stringify(TT.authOf({ authorization: basicHdr })).includes('S3cret'));
T.eq('in words, for the viewer and the report', [TT.authText(TT.authOf({ authorization: basicHdr })), TT.authText(TT.authOf({ authorization: 'Bearer x' })), TT.authText(TT.authOf({}))].join(' | '),
  'as priya.raman (Basic) | Bearer token | none');
const auth = TT.authOf({ authorization: basicHdr });
const EP = [
  TT.callEntry({ method: 'GET', service: 'eqpt', path: '/equipment?limit=5', url: 'http://h/__backend/eqpt/equipment?limit=5', status: 200, ms: 40, auth }),
  TT.callEntry({ method: 'GET', service: 'eqpt', path: '/equipmentRequests/123/lines', url: 'http://h/__backend/eqpt/equipmentRequests/123/lines', status: 200, ms: 12, auth }),
  TT.callEntry({ method: 'GET', service: 'eqpt', path: '/equipmentRequests/777/lines', url: 'http://h/__backend/eqpt/equipmentRequests/777/lines', status: 200, ms: 9, auth }),
  TT.callEntry({ method: 'POST', service: 'eqpt', path: '/equipmentRequests', url: 'http://h/__backend/eqpt/equipmentRequests', status: 500, ms: 800 }),
];
const eps = TT.endpoints(EP);
T.eq('the APIs used: one row per service + method + endpoint, ids collapsed, failures first', eps.map((g) => g.method + ' ' + g.endpoint + ' ×' + g.calls + (g.failed ? ' (' + g.failed + ' failed)' : '')).join(' | '),
  'POST /equipmentRequests ×1 (1 failed) | GET /equipmentRequests/{id}/lines ×2 | GET /equipment ×1');
T.eq('…each with the statuses seen and the login used (no secret)', [eps[1].statuses.join('/'), eps[1].auth.schemes.join(), eps[1].auth.users.join(), eps[0].auth.sent].join(' | '), '200 | Basic | priya.raman | false');
T.check('…the endpoints list never holds the secret', !JSON.stringify(eps).includes('S3cret'));

T.section('Whisper: the voice in a recording, turned to text (lib/transcribe.js)');
T.eq('whisper.cpp JSON → segments with seconds', JSON.stringify(TX.parseWhisperJson({ transcription: [{ offsets: { from: 0, to: 2500 }, text: ' The map does not load.' }, { offsets: { from: 2500, to: 5000 }, text: ' I click edit.' }] })),
  '[{"start":0,"end":2.5,"text":"The map does not load."},{"start":2.5,"end":5,"text":"I click edit."}]');
T.eq('OpenAI verbose_json → segments', JSON.stringify(TX.parseOpenai({ language: 'english', segments: [{ start: 0, end: 1.2, text: ' Hello' }] })), '[{"start":0,"end":1.2,"text":"Hello"}]');
T.eq('SRT (fallback) → segments', JSON.stringify(TX.parseSrt('1\n00:00:00,000 --> 00:00:02,500\nThe map\n\n2\n00:00:02,500 --> 00:00:05,000\ndoes not load')),
  '[{"start":0,"end":2.5,"text":"The map"},{"start":2.5,"end":5,"text":"does not load"}]');
T.eq('to SRT and to text, for download and Copy', [TX.toSrt([{ start: 0, end: 2.5, text: 'Hi' }]).trim(), TX.toText([{ start: 0, text: 'a' }, { start: 1, text: 'b' }])].join(' | '),
  '1\n00:00:00,000 --> 00:00:02,500\nHi | a\nb');
// nothing set up: it says what to install, and never pretends it ran
const none = TX.open({ which: () => '', modelsDir: path.join(dir, 'no-models') });
const noneInfo = none.info();
T.check('with no engine: nothing is ready, and the setup helper has what it needs (the install commands, the models to offer)',
  noneInfo.engines.length === 0 && noneInfo.local.ready === false && noneInfo.local.ffmpeg === false && noneInfo.openai.ready === false
  && !!noneInfo.install.ffmpeg && !!noneInfo.install.whisper && noneInfo.catalog.length >= 3 && noneInfo.catalog.every((m) => m.have === false));
(async () => {
  const r = await none.transcribe('/etc/hostname', { engine: 'local' });
  T.check('local, not installed: a clear error and how to set it up, not a fake transcript', !r.ok && /ffmpeg/.test(r.error) && !!r.setup && !r.segments);
})();
// local, set up: ffmpeg + whisper.cpp present (faked), a model on disk, whisper writes its JSON
const mdir = fs.mkdirSync(path.join(dir, 'models'), { recursive: true }) || path.join(dir, 'models');
fs.writeFileSync(path.join(mdir, 'ggml-base.bin'), 'x');
const ran = [];
const localEngine = TX.open({
  which: (c) => (c === 'ffmpeg' || c === 'whisper-cli' ? '/usr/bin/' + c : ''),
  modelsDir: mdir,
  tmpDir: dir,
  run: (cmd, args) => {
    ran.push(path.basename(cmd));
    if (/whisper/.test(cmd)) { const of = args[args.indexOf('-of') + 1]; fs.writeFileSync(of + '.json', JSON.stringify({ transcription: [{ offsets: { from: 0, to: 3000 }, text: 'The map does not load here.' }] })); }
    return Promise.resolve({ code: 0, stdout: '', stderr: '' });
  },
});
T.eq('set up: local Whisper is the engine offered', JSON.stringify(localEngine.info().engines), '["local"]');
(async () => {
  const r = await localEngine.transcribe(path.join(dir, 'EQP-196', fs.readdirSync(path.join(dir, 'EQP-196')).find((f) => / recording\.mp4$/.test(f))), { engine: 'local', lang: 'en' });
  T.eq('it runs ffmpeg then whisper.cpp, and reads the words back', [ran.join(','), r.ok, r.engine, r.segments.map((s) => s.text).join()].join(' | '),
    'ffmpeg,whisper-cli | true | local | The map does not load here.');
  T.check('…the temp WAV and JSON are cleaned up', fs.readdirSync(dir).filter((f) => /eqp-whisper/.test(f)).length === 0);
})();
// OpenAI engine: the audio is posted with the key; segments come back
let sent = null;
const openaiEngine = TX.open({ which: () => '', modelsDir: path.join(dir, 'none'), openaiKey: () => 'sk-test-key',
  fetch: (url, init) => { sent = { url, auth: init.headers.Authorization, hasBody: !!init.body }; return Promise.resolve({ ok: true, json: () => Promise.resolve({ language: 'english', segments: [{ start: 0, end: 2, text: 'Spoken words.' }] }) }); } });
T.eq('with an OpenAI key: that engine is offered', JSON.stringify(openaiEngine.info().engines), '["openai"]');
(async () => {
  const r = await openaiEngine.transcribe(path.join(dir, 'EQP-196', fs.readdirSync(path.join(dir, 'EQP-196')).find((f) => / recording\.mp4$/.test(f))), { engine: 'openai' });
  T.eq('it posts the audio to OpenAI with the key, and reads the words', [sent.url, /^Bearer sk-/.test(sent.auth), sent.hasBody, r.ok, r.segments[0].text].join(' | '),
    'https://api.openai.com/v1/audio/transcriptions | true | true | true | Spoken words.');
})();

T.section('set up Whisper: download a model, and what is missing');
const setupDir = path.join(dir, 'whisper-setup');
let fetched = '';
const setup = TX.open({ which: () => '', modelsDir: setupDir, reveal: () => {},
  fetch: (url) => { fetched = url; return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new Uint8Array(2 * 1024 * 1024).buffer) }); } });
T.check('the catalog offers several models to download, none here yet', setup.info().catalog.length === 5 && setup.info().catalog.every((m) => !m.have) && setup.info().canDownload);
(async () => {
  const bad = await setup.downloadModel('ggml-nonsense.bin');
  T.check('an unknown model is refused', !bad.ok && /Unknown/.test(bad.error));
  const r = await setup.downloadModel('ggml-base.bin');
  T.eq('download: fetched from whisper.cpp\'s model repo, written to the models folder', [r.ok, fetched.endsWith('/ggml-base.bin'), fs.existsSync(path.join(setupDir, 'ggml-base.bin'))].join(), 'true,true,true');
  const after = setup.info();
  T.check('…and now local Whisper is a step closer: the model shows as present', after.catalog.find((m) => m.name === 'ggml-base.bin').have === true && after.local.models.indexOf('ggml-base.bin') !== -1);
})();
const tooSmall = TX.open({ which: () => '', modelsDir: path.join(dir, 'ws2'), fetch: () => Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new Uint8Array(10).buffer) }) });
(async () => { const r = await tooSmall.downloadModel('ggml-tiny.bin'); T.check('a truncated download is rejected, not kept', !r.ok && !fs.existsSync(path.join(dir, 'ws2', 'ggml-tiny.bin'))); })();

T.section('the Install button runs the installer for a missing piece');
// no ffmpeg; a fake "run" stands in for winget / brew
const installRan = [];
const installer = TX.open({ which: (c) => (c === 'ffmpeg' ? '' : '/usr/bin/' + c), modelsDir: path.join(dir, 'ws3'),
  run: (cmd, args) => { installRan.push(cmd + ' ' + args.join(' ')); return Promise.resolve({ code: 0, stdout: 'Successfully installed', stderr: '' }); } });
T.check('info says ffmpeg can be installed here (there is a command for this OS)', installer.info().installable.ffmpeg === true);
(async () => {
  const r = await installer.install('ffmpeg');
  T.check('Install ffmpeg runs the OS installer and reports success', r.ok && /Successfully installed/.test(r.output)
    && (installRan[0].startsWith('winget ') || installRan[0].startsWith('brew ') || installRan[0].startsWith('sudo ')), JSON.stringify(installRan));
  const bad = await installer.install('something-else');
  T.check('a piece with no one-click install says so (not a fake success)', !bad.ok && /no one-click install/.test(bad.error));
})();

T.section('the store keeps a transcript next to its recording');
clock = new Date(2026, 10, 5, 16, 0, 0);
const vrec = store.start('EQP-500', 'webm');
store.chunk(vrec.id, Buffer.from('voice-video'));
const vitem = store.finish(vrec.id);
T.check('a fresh recording has no transcript yet', !vitem.transcript && !store.transcript('EQP-500', vitem.name));
const saved = store.saveTranscript('EQP-500', vitem.name, { engine: 'local', model: 'ggml-base.bin', lang: 'en', segments: [{ start: 0, end: 2.5, text: 'The map does not load.' }, { start: 2.5, end: 5, text: 'I click edit and nothing happens.' }] });
T.eq('saved: the recording\'s item now points at its transcript', [saved.transcript.segments, saved.transcript.lang, saved.transcript.engine, saved.transcript.url].join(' | '),
  '2 | en | local | /__rec/transcript/EQP-500/' + encodeURIComponent(vitem.name));
const got = store.transcript('EQP-500', vitem.name);
T.eq('read back for the viewer: the lines, with the video', [got.segments.length, got.segments[0].text, got.video.kind].join(' | '), '2 | The map does not load. | video');
T.check('as plain text and SRT', store.transcriptText('EQP-500', vitem.name) === 'The map does not load.\nI click edit and nothing happens.' && /00:00:02,500 --> 00:00:05,000/.test(store.transcriptSrt('EQP-500', vitem.name)));
store.remove('EQP-500', vitem.name);
T.check('removing the recording removes its transcript too', !fs.existsSync(path.join(dir, 'EQP-500', vitem.name.replace(/\.webm$/, '.transcript.json'))));

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
T.eq('which stories have evidence, in one read (the lists\' icon): recordings, screenshots, the latest; a story with nothing is left out',
  JSON.stringify(store.index()), '{"EQP-196":{"videos":2,"shots":3,"failed":0,"latest":"2026-11-05 15:00"}}');
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
  // a stand-in Whisper engine (the real one needs ffmpeg + whisper.cpp, or an OpenAI key, on the person's PC)
  const revealedModels = [];
  const fakeTx = { info: () => ({ engines: ['local'], local: { ready: true }, openai: { ready: false }, catalog: [{ name: 'ggml-base.bin', label: 'Base', mb: 142, have: false }], platform: 'linux', install: { ffmpeg: 'x', whisper: 'y' }, canDownload: true }),
    transcribe: (file) => Promise.resolve({ ok: !!file, engine: 'local', lang: 'en', model: 'ggml-base.bin', segments: [{ start: 0, end: 2.5, text: 'The map does not load here.' }, { start: 2.5, end: 5, text: 'I click edit and nothing.' }], ms: 5 }),
    downloadModel: (name) => Promise.resolve({ ok: true, name, size: 142 * 1048576 }),
    revealModels: () => { revealedModels.push(1); return { dir: '/models' }; },
    install: (what) => Promise.resolve({ ok: true, code: 0, output: 'installed ' + what, cmd: 'winget install ...' }) };
  const srv2 = await DS.createDevServer({ buildDir: build, webApp: 'vbredwoodapp', repoRoot: ROOT, port: 0, getIdentity: () => ({ username: 'tester' }), recStore: rs2, transcribe: fakeTx, onLog: () => {} });
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
    T.check('every call carries its login (none here: the test backend has no credential), never a secret', t2.entries.every((e) => e.auth && e.auth.sent === false)
      && !JSON.stringify(t2).includes('c2VjcmV0'));
    T.eq('the trace lists the APIs used: the two eqpt endpoints, the failed one first', (t2.apis || []).map((g) => g.service + ' ' + g.method + ' ' + g.endpoint + (g.failed ? ' (failed)' : '')).join(' | '),
      'eqpt POST /equipmentRequests (failed) | eqpt GET /equipment');
    const repRes = await req2('GET', '/__rec/report/EQP-12/' + encodeURIComponent(fin.name));
    const rep = repRes.body.toString();
    T.check('the bug report, as text, with the login line and the APIs used', repRes.headers['content-type'].startsWith('text/plain') && rep.includes('ORA-01400')
      && rep.includes('Login sent: none') && rep.includes('APIs used (2):') && rep.includes('POST eqpt /equipmentRequests'));
    const ix = JSON.parse((await req2('GET', '/__rec/index')).body);
    T.eq('the index: the story\'s recording, and the failure its trace caught', [ix['EQP-12'].videos, ix['EQP-12'].shots, ix['EQP-12'].failed].join(), '1,0,1');

    T.eq('which transcription engines are set up', JSON.parse((await req2('GET', '/__rec/transcribe-info')).body).engines.join(), 'local');
    T.eq('the setup helper can download a model (write-guarded)', [(await req2('POST', '/__rec/transcribe-model?name=ggml-base.bin')).status,
      JSON.parse((await req2('POST', '/__rec/transcribe-model?name=ggml-base.bin', W)).body).ok].join(), '403,true');
    T.check('…and open the models folder', JSON.parse((await req2('POST', '/__rec/transcribe-reveal', W)).body).dir === '/models' && revealedModels.length === 1);
    T.eq('…and run the installer (write-guarded)', [(await req2('POST', '/__rec/transcribe-install?what=ffmpeg')).status,
      JSON.parse((await req2('POST', '/__rec/transcribe-install?what=ffmpeg', W)).body).ok].join(), '403,true');
    T.eq('a write without the page\'s header: transcribe refused', (await req2('POST', '/__rec/transcribe?key=EQP-12&name=' + encodeURIComponent(fin.name))).status, 403);
    const tr = JSON.parse((await req2('POST', '/__rec/transcribe?key=EQP-12&name=' + encodeURIComponent(fin.name) + '&engine=local', W)).body);
    T.eq('transcribe: Whisper runs and the transcript is kept', [tr.ok, tr.engine, tr.lines, !!tr.item.transcript].join(' | '), 'true | local | 2 | true');
    const tx = JSON.parse((await req2('GET', '/__rec/transcript/EQP-12/' + encodeURIComponent(fin.name))).body);
    T.eq('the transcript, for the viewer: its lines, with the video', [tx.segments.length, tx.segments[0].text, tx.video.kind, tx.engine].join(' | '), '2 | The map does not load here. | video | local');
    const srt = await req2('GET', '/__rec/transcript.srt/EQP-12/' + encodeURIComponent(fin.name));
    T.check('a downloadable SRT and TXT', srt.headers['content-disposition'].includes('.srt') && /00:00:02,500 --> 00:00:05,000/.test(srt.body.toString())
      && (await req2('GET', '/__rec/transcript.txt/EQP-12/' + encodeURIComponent(fin.name))).body.toString() === 'The map does not load here.\nI click edit and nothing.');
    T.check('the recording\'s item now shows it has a transcript', !!JSON.parse((await req2('GET', '/__rec/list?key=EQP-12')).body).items.find((x) => x.kind === 'video').transcript);
  } finally {
    await srv2.close();
    fake.close();
  }
  T.report();
})();
