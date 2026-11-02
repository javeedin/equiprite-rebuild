'use strict';
/*
 * EquipRite Next · Ask AI in the SQL worksheet (desktop/lib/aiSql.js): each LLM called as its API expects (Claude,
 * ChatGPT, Oracle OCI Generative AI with its request signature, Gemini, any OpenAI-compatible service), the models from
 * the provider itself, keys encrypted and never sent back, the prompt with the schema's names only (never a row), the
 * SQL taken out of the answer, errors in words; /__sql/ai/ask reads the connected schema. With a fake fetch.
 * Run: node tests/next-ai.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const H = require('./_harness');
const { fakeOracle } = require('./e2e/fake-oracle');
const AI = require('../desktop/lib/aiSql');

const T = H.makeAsserter();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqr-ai-'));
const enc = (t) => Buffer.from('ENC:' + Buffer.from(t).toString('base64'));
const dec = (b) => Buffer.from(b.toString().slice(4), 'base64').toString();

/** A fake fetch: answers by URL, records each call (url, method, headers, body). */
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init) => {
    const i = init || {};
    calls.push({ url, method: i.method || 'GET', headers: i.headers || {}, body: i.body ? JSON.parse(i.body) : null, raw: i.body || '' });
    const hit = routes.filter((r) => r.match.test(url) && (!r.method || r.method === (i.method || 'GET')))[0];
    if (!hit) return { ok: false, status: 404, text: async () => JSON.stringify({ error: { message: 'no route ' + url } }) };
    const out = typeof hit.answer === 'function' ? hit.answer(url, i) : hit.answer;
    return { ok: (out.status || 200) < 400, status: out.status || 200, text: async () => JSON.stringify(out.body) };
  };
  f.calls = calls;
  return f;
}
const SQL_ANSWER = '```sql\nselect e.ename, e.sal from emp e where e.sal is null\n```\nEmployees with no salary recorded.';
const SCHEMA = { owner: 'EQUIPRITE', tables: [{ name: 'DEPT', kind: 'TABLE', columns: [{ name: 'DEPTNO', type: 'NUMBER' }, { name: 'DNAME', type: 'VARCHAR2' }] },
  { name: 'EMP', kind: 'TABLE', columns: [{ name: 'EMPNO', type: 'NUMBER' }, { name: 'ENAME', type: 'VARCHAR2' }, { name: 'SAL', type: 'NUMBER' }] }] };

(async () => {
  T.section('the LLMs offered, and what each asks for');
  T.eq('five choices', AI.PROVIDERS.map((p) => p.label).join(' | '), 'Claude (Anthropic) | ChatGPT (OpenAI) | Oracle OCI Generative AI | Google Gemini | Other (OpenAI-compatible)');
  T.eq('OCI asks for its tenancy and signing key', AI.PROVIDERS.filter((p) => p.id === 'oci')[0].fields.map((f) => f.key).join(), 'region,compartmentId,tenancyId,userId,fingerprint,privateKey,passphrase');
  T.check('no model is named in the code: the list comes from the provider', !/claude-|gpt-[0-9]|gemini-[0-9]|llama-[0-9]/i.test(fs.readFileSync(path.join(__dirname, '..', 'desktop', 'lib', 'aiSql.js'), 'utf8')));

  T.section('the prompt: the question and the schema\'s names, never a row');
  const up = AI.userPrompt({ question: 'employees without a salary', schema: SCHEMA, banner: 'Oracle Database 19c', sql: 'select * from dept' });
  T.check('the version, the tables with their columns, the worksheet SQL, the question', up.text.includes('Database: Oracle Database 19c') && up.text.includes('TABLE EMP (EMPNO NUMBER, ENAME VARCHAR2, SAL NUMBER)')
    && up.text.includes('select * from dept') && up.text.endsWith('Request: employees without a salary'), up.text);
  const big = { owner: 'X', tables: Array.from({ length: 300 }, (_, i) => ({ name: 'T' + i + (i === 250 ? '_RENTAL_REQUEST' : ''), kind: 'TABLE', columns: [{ name: 'ID', type: 'NUMBER' }] })) };
  const sc = AI.schemaText(big, 'rental requests last week');
  T.eq('a large schema: the tables the question names first, with columns; the rest by name only', [sc.detailed[0], sc.detailed.length, sc.tables].join(' | '), 'T250_RENTAL_REQUEST | 40 | 300');
  T.check('the rules: one Oracle statement in a sql block, a query unless a change is asked, never invent', /single ```sql code block/.test(AI.SYSTEM) && /Write a query/.test(AI.SYSTEM) && /Never invent/.test(AI.SYSTEM));
  T.eq('the SQL out of an answer', JSON.stringify(AI.parseAnswer(SQL_ANSWER)), '{"sql":"select e.ename, e.sal from emp e where e.sal is null","explain":"Employees with no salary recorded."}');
  T.eq('…a bare query', AI.parseAnswer('SELECT 1 FROM dual').sql, 'SELECT 1 FROM dual');
  T.eq('…no SQL: what it said instead', JSON.stringify(AI.parseAnswer('The schema has no salary column.')), '{"sql":"","explain":"The schema has no salary column."}');

  T.section('keys: encrypted on this PC, never sent back');
  const routes = [
    { match: /api\.anthropic\.com\/v1\/models/, answer: { body: { data: [{ id: 'model-b', display_name: 'Model B' }, { id: 'model-a', display_name: 'Model A' }] } } },
    { match: /api\.anthropic\.com\/v1\/messages/, method: 'POST', answer: { body: { content: [{ type: 'text', text: SQL_ANSWER }] } } },
    { match: /api\.openai\.com\/v1\/models/, answer: { body: { data: [{ id: 'gpt-x', created: 2 }, { id: 'text-embedding-x', created: 3 }, { id: 'o9-mini', created: 1 }, { id: 'gpt-x-audio', created: 4 }] } } },
    { match: /api\.openai\.com\/v1\/chat\/completions/, method: 'POST', answer: { body: { choices: [{ message: { content: SQL_ANSWER } }] } } },
    { match: /generativelanguage\.googleapis\.com\/v1beta\/models\?/, answer: { body: { models: [{ name: 'models/g-x', displayName: 'G X', supportedGenerationMethods: ['generateContent'] }, { name: 'models/emb', supportedGenerationMethods: ['embedContent'] }] } } },
    { match: /generativelanguage\.googleapis\.com\/v1beta\/models\/g-x:generateContent/, method: 'POST', answer: { body: { candidates: [{ content: { parts: [{ text: SQL_ANSWER }] } }] } } },
    { match: /localhost:11434\/v1\/models/, answer: { body: { data: [{ id: 'local-model' }] } } },
    { match: /localhost:11434\/v1\/chat\/completions/, method: 'POST', answer: { body: { choices: [{ message: { content: SQL_ANSWER } }] } } },
    { match: /generativeai\.us-chicago-1\.oci\.oraclecloud\.com\/20231130\/models/, answer: { body: { items: [{ displayName: 'vendor.chat-model', vendor: 'meta', capabilities: ['CHAT'] }, { displayName: 'cohere.chat-model', vendor: 'cohere', capabilities: ['CHAT'] }] } } },
    { match: /inference\.generativeai\.us-chicago-1\.oci\.oraclecloud\.com\/20231130\/actions\/chat/, method: 'POST', answer: (url, i) => {
      const b = JSON.parse(i.body);
      return { body: b.chatRequest.apiFormat === 'COHERE' ? { chatResponse: { text: SQL_ANSWER } } : { chatResponse: { choices: [{ message: { content: [{ type: 'TEXT', text: SQL_ANSWER }] } }] } } };
    } }
  ];
  const F = fakeFetch(routes);
  const file = path.join(tmp, 'ai-settings.json');
  const store = await AI.open({ file, encrypt: enc, decrypt: dec, fetch: F });
  const sv = store.save({ provider: 'anthropic', key: 'sk-ant-SECRET', model: '' });
  T.check('saved: the key encrypted on disk, the provider in use', !fs.readFileSync(file, 'utf8').includes('sk-ant-SECRET') && sv.keptIn === 'keychain' && store.settings().active === 'anthropic');
  T.eq('the settings say a key is kept, never the key', JSON.stringify(store.settings().providers.anthropic), '{"model":"","has_key":true,"hasKey":true}');
  store.save({ provider: 'anthropic', key: '', model: 'model-a' });
  let err = '';
  T.eq('saved again with an empty key: the key kept, the model set', [store.settings().providers.anthropic.has_key, store.settings().providers.anthropic.model].join(), 'true,model-a');

  T.section('Claude (Anthropic)');
  let m = await store.models('anthropic');
  T.eq('its models, from the provider, with the key', [m.ok, m.models.map((x) => x.label).join(' ; '), F.calls[0].headers['x-api-key'], F.calls[0].headers['anthropic-version']].join(' | '), 'true | Model B · model-b ; Model A · model-a | sk-ant-SECRET | 2023-06-01');
  let a = await store.ask({ question: 'employees without a salary', schema: SCHEMA, banner: 'Oracle Database 19c' });
  let last = F.calls[F.calls.length - 1];
  T.eq('asked: the SQL and why', [a.ok, a.sql, a.explain, a.provider, a.model, a.sent.tables].join(' | '), 'true | select e.ename, e.sal from emp e where e.sal is null | Employees with no salary recorded. | Claude (Anthropic) | model-a | 2');
  T.check('…the Messages API: the model, the rules as system, the prompt as the user', last.body.model === 'model-a' && last.body.system === AI.SYSTEM && last.body.messages[0].content.includes('TABLE EMP') && last.body.max_tokens > 0);

  T.section('ChatGPT (OpenAI), Gemini, an OpenAI-compatible service');
  store.save({ provider: 'openai', key: 'sk-OPENAI', model: '' });
  m = await store.models('openai');
  T.eq('OpenAI: chat models only, newest first', m.models.map((x) => x.id).join(), 'gpt-x,o9-mini');
  store.save({ provider: 'openai', model: 'gpt-x' });
  a = await store.ask({ question: 'employees without a salary', schema: SCHEMA });
  last = F.calls[F.calls.length - 1];
  T.check('…chat completions with the bearer key, system then user', a.ok && last.headers.authorization === 'Bearer sk-OPENAI' && last.body.messages.map((x) => x.role).join() === 'system,user');
  store.save({ provider: 'gemini', key: 'AIza-GEMINI' });
  m = await store.models('gemini');
  T.eq('Gemini: the models that generate content', m.models.map((x) => x.id).join(), 'g-x');
  store.save({ provider: 'gemini', model: 'g-x' });
  a = await store.ask({ question: 'employees without a salary', schema: SCHEMA });
  last = F.calls[F.calls.length - 1];
  T.check('…generateContent with the key in a header (not the URL), the rules as system instruction', a.ok && last.headers['x-goog-api-key'] === 'AIza-GEMINI' && !/key=/.test(last.url) && last.body.systemInstruction.parts[0].text === AI.SYSTEM);
  store.save({ provider: 'custom', baseUrl: 'http://localhost:11434/v1/', key: '' });
  m = await store.models('custom');
  store.save({ provider: 'custom', model: 'local-model' });
  a = await store.ask({ question: 'employees without a salary', schema: SCHEMA });
  last = F.calls[F.calls.length - 1];
  T.check('a model on this PC (Ollama): no key needed, the base URL used as given', m.models[0].id === 'local-model' && a.ok && last.url === 'http://localhost:11434/v1/chat/completions' && !last.headers.authorization);

  T.section('Oracle OCI Generative AI: signed as OCI expects');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const oci = { provider: 'oci', region: 'us-chicago-1', compartmentId: 'ocid1.compartment.oc1..c', tenancyId: 'ocid1.tenancy.oc1..t', userId: 'ocid1.user.oc1..u', fingerprint: 'aa:bb:cc', privateKey: pem };
  store.save(oci);
  T.check('the private key encrypted on disk', !fs.readFileSync(file, 'utf8').includes('BEGIN PRIVATE KEY'));
  m = await store.models('oci');
  last = F.calls[F.calls.length - 1];
  T.eq('its chat models, from OCI (the compartment asked)', [m.ok, m.models.map((x) => x.label).join(' ; '), /compartmentId=ocid1\.compartment\.oc1\.\.c/.test(last.url)].join(' | '), 'true | meta · vendor.chat-model ; cohere · cohere.chat-model | true');
  store.save({ provider: 'oci', model: 'vendor.chat-model' });
  a = await store.ask({ question: 'employees without a salary', schema: SCHEMA });
  last = F.calls[F.calls.length - 1];
  T.check('chat: on demand, the GENERIC format (system and user), the SQL back', a.ok && a.sql.startsWith('select e.ename') && last.body.servingMode.modelId === 'vendor.chat-model'
    && last.body.chatRequest.apiFormat === 'GENERIC' && last.body.chatRequest.messages.map((x) => x.role).join() === 'SYSTEM,USER');
  const auth = last.headers.authorization;
  const sig = /signature="([^"]+)"/.exec(auth)[1];
  const names = /headers="([^"]+)"/.exec(auth)[1].split(' ');
  const u = new URL(last.url);
  const signing = names.map((n) => n === '(request-target)' ? '(request-target): post ' + u.pathname : n === 'host' ? 'host: ' + u.host : n === 'content-length' ? 'content-length: ' + Buffer.byteLength(last.raw)
    : n + ': ' + last.headers[n]).join('\n');
  T.check('…its signature verifies with the public key (keyId tenancy/user/fingerprint, the body\'s SHA-256)', crypto.createVerify('RSA-SHA256').update(signing).verify(publicKey, sig, 'base64')
    && /keyId="ocid1\.tenancy\.oc1\.\.t\/ocid1\.user\.oc1\.\.u\/aa:bb:cc"/.test(auth) && last.headers['x-content-sha256'] === crypto.createHash('sha256').update(last.raw).digest('base64'), auth);
  store.save({ provider: 'oci', model: 'cohere.chat-model' });
  a = await store.ask({ question: 'employees without a salary', schema: SCHEMA });
  T.check('a Cohere model: the COHERE format', a.ok && F.calls[F.calls.length - 1].body.chatRequest.apiFormat === 'COHERE');

  T.section('errors in words');
  const bad = await AI.open({ file: path.join(tmp, 'bad.json'), encrypt: enc, decrypt: dec, fetch: fakeFetch([{ match: /anthropic/, answer: { status: 401, body: { error: { message: 'invalid x-api-key' } } } }]) });
  bad.save({ provider: 'anthropic', key: 'wrong' });
  m = await bad.models('anthropic');
  T.eq('a refused key', m.error, 'HTTP 401: invalid x-api-key (the key was refused: check it, and that it may use this model)');
  try { await bad.ask({ question: 'x', schema: SCHEMA }); } catch (e) { err = e.message; }
  T.eq('no model chosen: said', err, 'Choose a model for Claude (Anthropic) (AI settings, Load models).');
  err = '';
  try { await (await AI.open({ file: path.join(tmp, 'none.json'), fetch: F })).ask({ question: 'x' }); } catch (e) { err = e.message; }
  T.eq('no LLM chosen: said', err, 'Choose the LLM to use first (AI settings).');
  const noKeychain = await AI.open({ file: path.join(tmp, 'nk.json'), fetch: F });
  T.eq('no keychain on this PC: the key kept for this run only, never written', [noKeychain.save({ provider: 'openai', key: 'sk-RUN' }).keptIn, fs.readFileSync(path.join(tmp, 'nk.json'), 'utf8').includes('sk-RUN'),
    noKeychain.settings().providers.openai.has_key].join(), 'this run,false,true');
  store.forget('oci');
  T.eq('Remove key: gone from the file', [fs.readFileSync(file, 'utf8').includes('"oci"'), store.settings().providers.oci.has_privateKey].join(), 'false,false');

  T.section('/__sql/ai/ask reads the connected schema (names only) and answers');
  const build = path.join(tmp, 'build');
  fs.mkdirSync(path.join(build, 'processed', 'webApps', 'equiprite-next'), { recursive: true });
  fs.writeFileSync(path.join(build, 'processed', 'webApps', 'equiprite-next', 'index.html'), '<html></html>');
  const D = fakeOracle();
  const sqlStore = await require('../desktop/lib/oracleSql').open({ file: path.join(tmp, 'conns.json'), driver: D });
  const conn = await sqlStore.connect({ name: 'x', username: 'equiprite', password: 'secret', host: 'h', service: 's' });
  const sch = await sqlStore.schema(conn.session);
  T.eq('the schema: the owner, the tables and columns (recycle bin left out), the banner', [sch.owner, sch.tables.map((t) => t.name + '(' + t.columns.length + ')').join(), sch.banner.slice(0, 18)].join(' | '), 'EQUIPRITE | DEPT(2),EMP(5) | Oracle Database 19');
  store.save({ provider: 'anthropic', model: 'model-a' });
  const DS = require('../desktop/lib/devserver');
  const srv = await DS.createDevServer({ buildDir: build, webApp: 'equiprite-next', port: 0, getIdentity: () => null, sqlStore, aiStore: store, onLog: () => {} });
  const res = await new Promise((resolve) => {
    const rq = http.request({ host: '127.0.0.1', port: srv.port, path: '/__sql/ai/ask', method: 'POST', headers: { Host: 'localhost:' + srv.port, 'X-EquipRite-SQL': '1', 'Content-Type': 'application/json' } }, (r) => {
      let b = '';
      r.on('data', (x) => { b += x; });
      r.on('end', () => resolve(JSON.parse(b)));
    });
    rq.end(JSON.stringify({ session: conn.session, question: 'employees without a salary' }));
  });
  const sent = F.calls[F.calls.length - 1].body.messages[0].content;
  T.eq('answered with the SQL', res.sql, 'select e.ename, e.sal from emp e where e.sal is null');
  T.check('…the LLM was sent the names, never a row', sent.includes('TABLE EMP (EMPNO NUMBER, ENAME VARCHAR2, SAL NUMBER, HIREDATE DATE, DEPTNO NUMBER)') && !sent.includes('EMP 1') && !sent.includes('BIN$'), sent);
  const settingsBody = await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: srv.port, path: '/__sql/ai/settings', headers: { Host: 'localhost:' + srv.port, 'X-EquipRite-SQL': '1' } }, (r) => { let b = ''; r.on('data', (x) => { b += x; }); r.on('end', () => resolve(b)); });
  });
  T.check('the settings the page reads hold no key', !/sk-ant-SECRET|sk-OPENAI|AIza-GEMINI|ENC:/.test(settingsBody), settingsBody);
  await srv.close();
  await sqlStore.close();

  T.report();
})();
