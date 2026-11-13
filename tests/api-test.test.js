#!/usr/bin/env node
'use strict';
/**
 * The API tester (desktop/lib/apiTest.js) and its routes (/__api/*, desktop/lib/devserver.js), against a fake backend:
 *   what a call sends, read from the real service connections (parameters, body, reads or writes, the saved example);
 *   sent through the server's own /__backend proxy (the Fusion login added, as for the app); a write only once
 *   confirmed; the answer read (rows, a report's rows decoded, its shape against the example, a SOAP fault); the values
 *   remembered and offered to the next call; Check all (an id from one answer fills the call that needs it); the page's
 *   reports read from its code; only the app's own page may ask.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const H = require('./_harness');
const A = require('../desktop/lib/apiTest');
const DS = require('../desktop/lib/devserver');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const EXAMPLE = JSON.parse(fs.readFileSync(path.join(ROOT, 'services/eqp-v1/examples/getEquipriteV1EquipmentMaster/response_default_application_json_vb.json'), 'utf8'));
const REPORT_XML = '<?xml version="1.0"?><DATA_DS><P_PROJECT_ID>42</P_PROJECT_ID><G_1><CONTRACT_ID>7</CONTRACT_ID><CONTRACT_NUMBER>C-7 &amp; co</CONTRACT_NUMBER><STATUS>ACTIVE</STATUS></G_1>'
  + '<G_1><CONTRACT_ID>8</CONTRACT_ID><CONTRACT_NUMBER>C-8</CONTRACT_NUMBER><STATUS/></G_1></DATA_DS>';

(async () => {
  // ── pure parts ──
  const list = A.opOf(ROOT, 'eqp-v1/getEquipriteV1EquipmentMaster');
  T.check('a call read from its service connection: GET, its path, only reads, its query parameters, the example it was built with',
    list.ok && list.method === 'GET' && list.path === '/equiprite/v1/equipment-master' && list.reads && list.backend === 'eqpt' && list.params.length > 0
    && list.params.every((p) => p.in === 'query') && /examples\/getEquipriteV1EquipmentMaster\/response_/.test(list.example), JSON.stringify(list.params.map((p) => p.name)));
  const byId = A.opOf(ROOT, 'eqp-v1/getEquipriteV1EquipmentMasterById');
  T.check('a path placeholder the service does not describe is still a required parameter', byId.params[0].name === 'id' && byId.params[0].in === 'path' && byId.params[0].required);
  const create = A.opOf(ROOT, 'eqp-v1/createAgreementLine');
  T.check('a POST that creates: changes data, with a JSON body to start from', create.ok && !create.reads && create.body && create.body.required && /json/.test(create.body.contentType) && create.body.template === '{}');
  const bip = A.opOf(ROOT, A.BIP);
  T.check('the report runner: a POST that only reads, its SOAP header, an envelope to start from', bip.reads && bip.report && /soap/.test(bip.headers['Content-Type']) && /reportAbsolutePath/.test(bip.body.template));
  T.check('…and a name that is not there says why', /no service "nope"/.test(A.opOf(ROOT, 'nope/x').error) && /no operation "zzz"/.test(A.opOf(ROOT, 'eqp-v1/zzz').error));
  const u = A.urlOf(byId, { params: { id: 'a/b 1' }, extra: 'limit=5&q=%20x\nfields=id' });
  T.check('the address: the path parameter encoded, more parameters typed as a=1&b=2 (already-encoded taken as meant)', u.path === '/equiprite/v1/equipment-master/a%2Fb%201' && u.query === '?limit=5&q=%20x&fields=id' && !u.missing.length, JSON.stringify(u));
  T.check('…a required one empty: listed', A.urlOf(byId, { params: {} }).missing.join() === 'id');
  T.check('the report envelope escapes what it is given', /<pub:name>P_A<\/pub:name><pub:values><pub:item>1 &amp; 2<\/pub:item>/.test(A.soapBody('/Custom/X/Y.xdo', [{ name: 'P_A', value: '1 & 2' }])));
  const soap = '<env:Envelope><env:Body><ns2:runReportResponse><ns2:runReportReturn><ns2:reportBytes>' + Buffer.from(REPORT_XML).toString('base64') + '</ns2:reportBytes></ns2:runReportReturn></ns2:runReportResponse></env:Body></env:Envelope>';
  const rows = A.xmlRows(Buffer.from(A.reportBytesOf(soap), 'base64').toString('utf8'));
  T.check('a report: its bytes found whatever the prefix, decoded; its rows (G_1), fields unescaped, an empty one empty', rows.tag === 'G_1' && rows.rows.length === 2
    && rows.rows[0].CONTRACT_NUMBER === 'C-7 & co' && rows.rows[1].STATUS === '' && !('P_PROJECT_ID' in rows.rows[0]), JSON.stringify(rows));
  T.eq('…without G_1: the most repeated element that holds others', A.rowTagOf('<R><ROW><A>1</A></ROW><ROW><A>2</A></ROW></R>'), 'ROW');
  const t1 = A.rowsOf({ items: [{ a: 1, b: { c: 2 } }, { a: 3, d: null }], count: 2, hasMore: true });
  T.check('rows of an answer: its list, the columns its records have, an object shown short, count and hasMore', t1.from === 'items' && t1.columns.join() === 'a,b,d' && t1.rows[0][1] === '{"c":2}' && t1.rows[1][2] === '' && t1.meta === 'count 2 · hasMore true');
  T.check('…a bare list, one record, a list of values', A.rowsOf([{ x: 1 }]).from === 'the answer' && A.rowsOf({ id: 1 }).from === 'one record' && A.rowsOf(['a', 'b']).columns[0] === 'value');
  const bad = JSON.parse(JSON.stringify(EXAMPLE));
  delete bad.data[0].equipmentName; bad.data.forEach((r) => { delete r.equipmentName; r.mfgYear = String(r.mfgYear); r.newField = 1; });
  const sh = A.compareShape(EXAMPLE, bad);
  T.check('the shape against the example: a field gone, a type changed, a new field', sh.status === 'differs' && sh.missing.indexOf('data[].equipmentName') !== -1
    && sh.changed.indexOf('data[].mfgYear: number → string') !== -1 && sh.extra.indexOf('data[].newField') !== -1, JSON.stringify(sh));
  const empty = A.compareShape(EXAMPLE, Object.assign({}, EXAMPLE, { data: [] }));
  T.check('…no rows: nothing to compare, not "gone"; null says nothing of a type', empty.status === 'same' && empty.empty && A.compareShape({ a: 1 }, { a: null }).status === 'same');
  T.eq('XML laid out to read', A.prettyXml('<a><b>1</b><c/><d><e>2</e></d></a>'), '<a>\n  <b>1</b>\n  <c/>\n  <d>\n    <e>2</e>\n  </d>\n</a>');
  T.check('the same call as curl: the password left out', /^curl -X GET 'http:\/\/h\/p\?q=it'\\''s'/.test(A.curlOf({ method: 'GET', url: "http://h/p?q=it's", user: 'u' })) && /-u 'u:<password>'/.test(A.curlOf({ method: 'GET', url: 'x', user: 'u' })));
  const chain = fs.readFileSync(path.join(ROOT, 'webApps/vbredwoodapp/flows/customer-portal/pages/project-create-request-page-chains/LoadContractsChain.js'), 'utf8');
  const rep = A.reportsIn([{ path: 'LoadContractsChain.js', text: chain }]);
  T.check('a page\'s report read from its code: its path, its parameters, its row element', rep.length === 1 && rep[0].name === 'EQP_CONTRACTS_BY_PROJECT_LOV_RP'
    && rep[0].path === '/Custom/EquipRite/EQP_CONTRACTS_BY_PROJECT_LOV_RP.xdo' && rep[0].params.join() === 'P_PROJECT_ID' && rep[0].rowTag === 'G_1', JSON.stringify(rep));

  // ── through the server, against a fake backend ──
  const seen = [];
  const backend = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', ct: req.headers['content-type'] || '', body: b });
      const j = (s, v) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
      if (req.url === '/equiprite/v1/equipment-master') return j(200, EXAMPLE);
      if (req.url.indexOf('/equiprite/v1/equipment-master?') === 0) return j(200, bad);
      if (/^\/equiprite\/v1\/equipment-master\/\d+$/.test(req.url)) return j(200, EXAMPLE.data[0]);
      if (req.url === '/equiprite/v1/agreement-lines' && req.method === 'POST') return j(201, { id: 5 });
      if (req.url.indexOf('/xmlpserver/') === 0) {
        if (/NOPE_RP/.test(b)) { res.writeHead(500, { 'content-type': 'application/soap+xml' }); return res.end('<env:Envelope><env:Body><env:Fault><env:Reason><env:Text>Report not found</env:Text></env:Reason></env:Fault></env:Body></env:Envelope>'); }
        res.writeHead(200, { 'content-type': 'application/soap+xml' }); return res.end(soap);
      }
      return j(404, { error: 'nothing at ' + req.url });
    });
  });
  await new Promise((r) => backend.listen(0, '127.0.0.1', r));
  const fake = `http://127.0.0.1:${backend.address().port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-api-'));
  const build = path.join(tmp, 'build');
  const web = path.join(build, 'processed', 'webApps', 'equiprite-next');
  fs.mkdirSync(web, { recursive: true });
  fs.mkdirSync(path.join(build, 'processed', 'services'), { recursive: true });
  fs.writeFileSync(path.join(web, 'index.html'), '<html>next</html>');
  fs.writeFileSync(path.join(build, 'processed', 'services', 'catalog.json'), fs.readFileSync(path.join(ROOT, 'services', 'catalog.json')));
  const store = A.open({ root: ROOT, file: path.join(tmp, 'api-tests.json') });
  const identity = { username: 'javeed', fusion: { user: 'javeed.shaik', password: 'pw' } };
  const srv = await DS.createDevServer({ buildDir: build, webApp: 'equiprite-next', port: 0, getIdentity: () => identity,
    backendOverrides: { eqpt: fake, bipservice: fake, fusion: fake }, apiStore: store, onLog: () => {} });
  const req = (method, p, body, headers) => new Promise((resolve, reject) => {
    const r = http.request({ host: 'localhost', port: srv.port, path: p, method, headers: Object.assign({ 'content-type': 'application/json', 'x-equiprite-api': '1' }, headers || {}) }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b, json: (() => { try { return JSON.parse(b); } catch (e) { return null; } })() }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
  try {
    T.eq('without the page\'s header: refused', (await req('GET', '/__api/op?endpoint=eqp-v1/getEquipriteV1EquipmentMaster', null, { 'x-equiprite-api': '' })).status, 403);
    T.eq('from another site: refused', (await req('GET', '/__api/op?endpoint=x/y', null, { origin: 'https://evil.example.com' })).status, 403);
    const op = (await req('GET', '/__api/op?endpoint=eqp-v1/getEquipriteV1EquipmentMaster')).json;
    T.check('what it sends and where: the backend\'s address, no login needed; the example not sent to the page', op.ok && op.backend.url === fake && op.backend.login === 'None needed' && op.op.exampleValue === undefined && op.history.length === 0);
    const fop = (await req('GET', '/__api/op?endpoint=ProjectLOV/getFscmRestApiResources11_13_18_05ProjectTasksLOV')).json;
    T.check('a Fusion call: with your Fusion login (named, never the password)', /Your Fusion login \(javeed\.shaik\)/.test(fop.backend.login) && fop.backend.loginOk && JSON.stringify(fop).indexOf('pw') === -1);
    const r1 = (await req('POST', '/__api/run', { endpoint: 'eqp-v1/getEquipriteV1EquipmentMaster', params: {} })).json;
    T.check('sent: 200, its time and size, its rows as a table, its shape the same as the example', r1.ok && r1.status === 200 && r1.statusText === 'OK' && r1.ms >= 0 && r1.size > 100
      && r1.table.from === 'data' && r1.table.total === EXAMPLE.data.length && r1.table.columns.indexOf('equipmentName') !== -1 && r1.shape.status === 'same' && /"equipmentName"/.test(r1.pretty), JSON.stringify(r1.shape));
    T.check('…through the proxy, to the backend\'s path; its headers and curl', seen[seen.length - 1].url === '/equiprite/v1/equipment-master' && r1.headers.some((h) => h.k === 'content-type') && /^curl -X GET '/.test(r1.curl));
    const r2 = (await req('POST', '/__api/run', { endpoint: 'eqp-v1/getEquipriteV1EquipmentMaster', params: { [list.params[0].name]: '1' } })).json;
    T.check('an answer that differs from the example: what is gone, what changed type', r2.ok && r2.shape.status === 'differs' && r2.shape.missing.indexOf('data[].equipmentName') !== -1 && r2.shape.counts.changed >= 1);
    const fus = (await req('POST', '/__api/run', { endpoint: 'ProjectLOV/getFscmRestApiResources11_13_18_05ProjectTasksLOV', params: { q: 'ProjectId=1' } })).json;
    T.check('a Fusion call goes with your Fusion login, as the app\'s do; a 404 is not ok, and says why', !fus.ok && fus.status === 404 && seen[seen.length - 1].auth === 'Basic ' + Buffer.from('javeed.shaik:pw').toString('base64') && /nothing at/.test(fus.error));
    const miss = (await req('POST', '/__api/run', { endpoint: 'eqp-v1/getEquipriteV1EquipmentMasterById', params: {} })).json;
    T.check('a required parameter empty: nothing sent, it says which', !miss.ok && miss.missing.join() === 'id' && /Fill in id/.test(miss.error));
    const before = seen.length;
    const w = (await req('POST', '/__api/run', { endpoint: 'eqp-v1/createAgreementLine', body: '{"lineNumber":1}' })).json;
    T.check('a call that changes data: not sent until confirmed', !w.ok && w.needsConfirm && /changes data/.test(w.error) && seen.length === before);
    T.check('…a body that is not JSON: says so', /not valid JSON/.test((await req('POST', '/__api/run', { endpoint: 'eqp-v1/createAgreementLine', body: '{oops', confirm: true })).json.error));
    const w2 = (await req('POST', '/__api/run', { endpoint: 'eqp-v1/createAgreementLine', body: '{"lineNumber":1}', confirm: true })).json;
    T.check('…confirmed: sent, with its body and type', w2.ok && w2.status === 201 && seen[seen.length - 1].method === 'POST' && seen[seen.length - 1].body === '{"lineNumber":1}' && /json/.test(seen[seen.length - 1].ct));
    const again = (await req('GET', '/__api/op?endpoint=eqp-v1/getEquipriteV1EquipmentMaster')).json;
    T.check('the values last used and its runs, remembered (newest first)', again.saved && again.saved.params[list.params[0].name] === '1' && again.history.length === 2 && again.history[0].shape === 'differs' && again.history[1].rows === EXAMPLE.data.length);
    const sug = (await req('GET', '/__api/op?endpoint=eqp-v1/getEquipriteV1EquipmentMasterById')).json;
    T.check('a value seen in an answer is offered to a parameter of the same name (an id from the list → its detail)', sug.suggest.id && sug.suggest.id[0].value === String(EXAMPLE.data[0].id) && /getEquipriteV1EquipmentMaster/.test(sug.suggest.id[0].from), JSON.stringify(sug.suggest));

    // a report of the page, read from its code, run with its parameter
    const rp = (await req('POST', '/__api/run', { report: { path: '/Custom/EquipRite/EQP_CONTRACTS_BY_PROJECT_LOV_RP.xdo', name: 'EQP_CONTRACTS_BY_PROJECT_LOV_RP', params: ['P_PROJECT_ID'], rowTag: 'G_1' }, params: { P_PROJECT_ID: '42' } })).json;
    const sent = seen[seen.length - 1];
    T.check('a report run: the envelope the app sends (its path, its parameter), to BI Publisher with the Fusion login; its rows decoded', rp.ok && rp.report.rowTag === 'G_1' && rp.table.total === 2
      && rp.table.rows[0].join('|') === '7|C-7 & co|ACTIVE' && /reportAbsolutePath>\/Custom\/EquipRite\/EQP_CONTRACTS_BY_PROJECT_LOV_RP\.xdo</.test(sent.body) && /<pub:name>P_PROJECT_ID<\/pub:name><pub:values><pub:item>42</.test(sent.body)
      && /soap/.test(sent.ct) && /^Basic /.test(sent.auth) && /<CONTRACT_NUMBER>C-7 &amp; co<\/CONTRACT_NUMBER>/.test(rp.pretty), JSON.stringify(rp.table));
    const fault = (await req('POST', '/__api/run', { report: { path: '/Custom/EquipRite/NOPE_RP.xdo' } })).json;
    T.check('…a SOAP fault: not ok, its reason', !fault.ok && fault.status === 500 && fault.fault === 'Report not found');
    T.check('…not a report path: refused', /Not a report path/.test((await req('POST', '/__api/run', { report: { path: 'http://evil/x' } })).json.error));

    // Check all: the reads run; the detail needs an id → the one the list answered; the write is left alone
    const fresh = A.open({ root: ROOT, file: path.join(tmp, 'fresh.json') });
    const srv2 = await DS.createDevServer({ buildDir: build, webApp: 'equiprite-next', port: 0, getIdentity: () => identity, backendOverrides: { eqpt: fake, bipservice: fake }, apiStore: fresh, onLog: () => {} });
    const c = await new Promise((resolve, reject) => {
      const r = http.request({ host: 'localhost', port: srv2.port, path: '/__api/check', method: 'POST', headers: { 'content-type': 'application/json', 'x-equiprite-api': '1' } }, (res) => { let b = ''; res.on('data', (x) => { b += x; }); res.on('end', () => resolve(JSON.parse(b))); });
      r.on('error', reject);
      r.end(JSON.stringify({ endpoints: ['eqp-v1/getEquipriteV1EquipmentMasterById', 'eqp-v1/getEquipriteV1EquipmentMaster', 'eqp-v1/createAgreementLine', A.BIP, 'eqp-v1/getRoleById', 'nope/x'] }));
    });
    const by = (e) => c.results.filter((x) => x.endpoint === e)[0];
    T.check('Check all: the list runs; its detail runs with the id the list answered', by('eqp-v1/getEquipriteV1EquipmentMaster').state === 'ok' && by('eqp-v1/getEquipriteV1EquipmentMasterById').state === 'ok'
      && new RegExp('with id=' + EXAMPLE.data[0].id + ' \\(from getEquipriteV1EquipmentMaster\\)').test(by('eqp-v1/getEquipriteV1EquipmentMasterById').note), JSON.stringify(c.results));
    T.check('…a write is left alone, the report runner points at the reports; another list\'s detail is not given an equipment id (an id is only its own list\'s): it says what it needs', by('eqp-v1/createAgreementLine').state === 'skip' && /Changes data/.test(by('eqp-v1/createAgreementLine').note)
      && /reports/.test(by(A.BIP).note) && by('eqp-v1/getRoleById').state === 'skip' && /^Needs id/.test(by('eqp-v1/getRoleById').note), JSON.stringify(by('eqp-v1/getRoleById')));
    T.check('…counted', c.passed === 2 && c.failed === 0 && c.skipped >= 3 && by('nope/x').state === 'skip', JSON.stringify([c.passed, c.warned, c.failed, c.skipped]));
    const lastR = (await new Promise((resolve) => {
      const r = http.request({ host: 'localhost', port: srv2.port, path: '/__api/last', method: 'POST', headers: { 'content-type': 'application/json', 'x-equiprite-api': '1' } }, (res) => { let b = ''; res.on('data', (x) => { b += x; }); res.on('end', () => resolve(JSON.parse(b))); });
      r.end(JSON.stringify({ keys: ['eqp-v1/getEquipriteV1EquipmentMaster', 'eqp-v1/createAgreementLine'] }));
    }));
    T.check('the last run of each call (shown beside it in the REST table)', lastR.last['eqp-v1/getEquipriteV1EquipmentMaster'].status === 200 && !lastR.last['eqp-v1/createAgreementLine']);
    await srv2.close();
    store.flush();
    const kept = JSON.parse(fs.readFileSync(path.join(tmp, 'api-tests.json'), 'utf8'));
    T.check('kept on this PC: values, runs, values seen — never the login', kept.values['eqp-v1/getEquipriteV1EquipmentMaster'] && kept.history['report:/Custom/EquipRite/EQP_CONTRACTS_BY_PROJECT_LOV_RP.xdo'].length === 1 && JSON.stringify(kept).indexOf('"pw"') === -1);
    const reopened = A.open({ root: ROOT, file: path.join(tmp, 'api-tests.json') });
    T.check('…and read back when the app starts again', reopened.last(['eqp-v1/getEquipriteV1EquipmentMaster']).last['eqp-v1/getEquipriteV1EquipmentMaster'].status === 200);
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await srv.close();
    backend.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
  T.report();
})();
