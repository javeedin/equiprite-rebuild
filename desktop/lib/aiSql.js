'use strict';
/**
 * Ask AI in EquipRite Next's SQL worksheet: a question in plain words → one Oracle SQL statement, written by the LLM the
 * person chooses, with their own key. The desktop app makes the call (never the page), so a key stays encrypted on this
 * PC and is never sent back to the page. What goes to the LLM: the question, the names of the schema's tables and
 * columns (and their types), the database version, and the worksheet's SQL when there is some. Never any row of data.
 *
 *   open({ file, encrypt, decrypt, fetch, now }) → store
 *   PROVIDERS                         the LLMs offered (labels, fields, how to call them)
 *   settings()                        { active, providers: { id: { …fields, hasKey, model } } }, never a key
 *   save({ provider, …fields, key })  the provider's settings; an empty key keeps the saved one; it becomes the active one
 *   forget(provider)                  its keys removed
 *   models(provider)                  { ok, models: [{ id, label }] }: the models the key may use, from the provider itself
 *   ask({ question, schema, sql, banner }) → { ok, sql, explain, provider, model, ms, sent }
 *
 * No model is named here: the list comes from the provider (its /models), and the person picks one.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let childProcess = null;
try { childProcess = require('child_process'); } catch (e) { childProcess = null; }

const TIMEOUT_MS = 90 * 1000;
const LONG_MS = 6 * 60 * 1000; // a long answer (Code Fix: the analysis and the edits)
const MAX_ASK = 32000; // the most tokens a caller may ask for
const MAX_TOKENS = 2000;

// Run the locally-installed Claude Code CLI (`claude -p`) for the "Claude Code (your subscription)" provider: the prompt
// goes in on stdin, the answer comes back on stdout. No API key — it uses the Max/Pro login Claude Code is signed in with.
function runClaudeCode(args, input, ms) {
  return new Promise((resolve) => {
    if (!childProcess) { resolve({ code: -1, stdout: '', stderr: 'No child_process in this app.' }); return; }
    let cp;
    try { cp = childProcess.spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { resolve({ code: -1, stdout: '', stderr: String((e && e.message) || e) }); return; }
    let out = '', err = '';
    const timer = setTimeout(() => { try { cp.kill('SIGKILL'); } catch (e) { /* gone */ } }, ms || TIMEOUT_MS);
    cp.stdout.on('data', (d) => { out += d; });
    cp.stderr.on('data', (d) => { err += d; });
    cp.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout: '', stderr: String((e && e.message) || e) }); });
    cp.on('close', (code) => { clearTimeout(timer); resolve({ code: code, stdout: out, stderr: err }); });
    try { if (input != null) cp.stdin.write(String(input)); cp.stdin.end(); } catch (e) { /* stdin closed */ }
  });
}

/** The LLMs offered. fields: what the dialog asks for (secret: encrypted, never sent back). */
const PROVIDERS = [
  { id: 'anthropic', label: 'Claude (Anthropic)', note: 'An Anthropic API key, from console.anthropic.com.',
    fields: [{ key: 'key', label: 'API key', secret: true }] },
  { id: 'openai', label: 'ChatGPT (OpenAI)', note: 'An OpenAI API key, from platform.openai.com.',
    fields: [{ key: 'key', label: 'API key', secret: true }] },
  { id: 'oci', label: 'Oracle OCI Generative AI', note: 'Your OCI tenancy: the region with Generative AI, a compartment, and an API signing key (OCI console, your user, API keys).',
    fields: [{ key: 'region', label: 'Region', hint: 'e.g. us-chicago-1' }, { key: 'compartmentId', label: 'Compartment OCID' }, { key: 'tenancyId', label: 'Tenancy OCID' },
      { key: 'userId', label: 'User OCID' }, { key: 'fingerprint', label: 'Key fingerprint' }, { key: 'privateKey', label: 'Private key (PEM)', secret: true, area: true },
      { key: 'passphrase', label: 'Key passphrase (if any)', secret: true }] },
  { id: 'gemini', label: 'Google Gemini', note: 'A Gemini API key, from Google AI Studio.',
    fields: [{ key: 'key', label: 'API key', secret: true }] },
  { id: 'custom', label: 'Other (OpenAI-compatible)', note: 'Any service that speaks the OpenAI chat API: Azure OpenAI, Mistral, Groq, DeepSeek, or a model on this PC (Ollama, LM Studio).',
    fields: [{ key: 'baseUrl', label: 'Base URL', hint: 'e.g. http://localhost:11434/v1' }, { key: 'key', label: 'API key (if any)', secret: true }] },
  { id: 'claudecode', label: 'Claude Code (your subscription)', note: 'Uses the Claude Code app signed in on this PC with your Claude Max/Pro subscription — no API key, and no per-call API cost. Needs Claude Code installed and signed in.',
    fields: [] }
];
const BY_ID = {};
PROVIDERS.forEach((p) => { BY_ID[p.id] = p; });

function trim(v) { return v == null ? '' : String(v).trim(); }

// ── The prompt ───────────────────────────────────────────────────────────────────────────────────────────────────
const SYSTEM = [
  'You write Oracle SQL inside the SQL worksheet of EquipRite, an equipment rental and project application on Oracle.',
  'Write exactly one Oracle SQL statement that answers the request, for the database version given, using only the tables and columns listed.',
  'Return the statement in a single ```sql code block, then at most two short sentences: what it returns, and any assumption you made.',
  'Write a query (SELECT or WITH). Write INSERT, UPDATE, DELETE, MERGE, DDL or PL/SQL only when the request explicitly asks to change data or objects.',
  'Use table aliases; qualify columns; limit long lists with FETCH FIRST n ROWS ONLY (12c and later) unless asked for everything.',
  'Never invent a table or a column. If the listed schema cannot answer the request, write no SQL and say what is missing.'
].join(' ');

/**
 * The schema as the prompt carries it: the tables most likely to matter (their names or columns share a word with the
 * question) with their columns, then the other tables' names. Bounded, so a large schema fits.
 */
function schemaText(schema, question, opts) {
  const o = opts || {};
  const maxFull = o.maxFull || 40;
  const maxNames = o.maxNames || 600;
  const tables = (schema && schema.tables) || [];
  const words = String(question || '').toUpperCase().split(/[^A-Z0-9_$#]+/).filter((w) => w.length >= 3)
    .map((w) => w.replace(/(IES|ES|S)$/, (m) => (m === 'IES' ? 'Y' : '')));
  const score = (t) => {
    let n = 0;
    words.forEach((w) => {
      if (t.name.indexOf(w) !== -1) n += 5;
      t.columns.forEach((c) => { if (c.name.indexOf(w) !== -1) n += 1; });
    });
    return n;
  };
  const ranked = tables.map((t, i) => ({ t, s: score(t), i })).sort((a, b) => b.s - a.s || a.i - b.i);
  const full = ranked.slice(0, maxFull).map((x) => x.t);
  const rest = ranked.slice(maxFull).map((x) => x.t.name).slice(0, maxNames);
  const lines = full.map((t) => (t.kind === 'VIEW' ? 'VIEW ' : 'TABLE ') + t.name + ' (' + t.columns.map((c) => c.name + ' ' + c.type).join(', ') + ')');
  return {
    text: lines.join('\n') + (rest.length ? '\n\nOther tables and views (names only): ' + rest.join(', ') : ''),
    tables: full.length + rest.length,
    detailed: full.map((t) => t.name)
  };
}

function userPrompt(q) {
  const sc = schemaText(q.schema, q.question);
  return {
    text: 'Database: ' + (q.banner || 'Oracle Database') + '\nSchema ' + ((q.schema && q.schema.owner) || '') + ':\n' + sc.text
      + (trim(q.sql) ? '\n\nThe worksheet holds this SQL now (change it if the request is about it):\n' + String(q.sql).slice(0, 6000) : '')
      + '\n\nRequest: ' + trim(q.question),
    tables: sc.tables
  };
}

/** The SQL and the words around it, from the LLM's answer. */
function parseAnswer(text) {
  const t = String(text || '').trim();
  const m = /```(?:sql|SQL|plsql)?\s*\n?([\s\S]*?)```/.exec(t);
  if (m) {
    const sql = m[1].trim();
    const explain = (t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim().slice(0, 600);
    return { sql, explain };
  }
  if (/^\s*(SELECT|WITH)\b/i.test(t)) return { sql: t, explain: '' };
  return { sql: '', explain: t.replace(/\s+/g, ' ').slice(0, 600) };
}

// ── OCI request signing (the HTTP signature OCI's APIs expect) ───────────────────────────────────────────────────
function ociSign(c, method, url, body, now) {
  const u = new URL(url);
  const date = new Date(now()).toUTCString();
  const headers = { 'x-date': date, host: u.host };
  const names = ['x-date', '(request-target)', 'host'];
  if (method === 'POST' || method === 'PUT') {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(body || ''));
    headers['x-content-sha256'] = crypto.createHash('sha256').update(body || '').digest('base64');
    names.push('content-length', 'content-type', 'x-content-sha256');
  }
  const target = method.toLowerCase() + ' ' + u.pathname + u.search;
  const signing = names.map((n) => (n === '(request-target)' ? '(request-target): ' + target : n + ': ' + headers[n])).join('\n');
  const key = crypto.createPrivateKey(c.passphrase ? { key: c.privateKey, passphrase: c.passphrase } : c.privateKey);
  const signature = crypto.createSign('RSA-SHA256').update(signing).sign(key, 'base64');
  const out = { 'x-date': date, authorization: `Signature version="1",keyId="${trim(c.tenancyId)}/${trim(c.userId)}/${trim(c.fingerprint)}",algorithm="rsa-sha256",headers="${names.join(' ')}",signature="${signature}"` };
  if (headers['content-type']) { out['content-type'] = headers['content-type']; out['x-content-sha256'] = headers['x-content-sha256']; }
  return { headers: out, signing };
}

async function open(opts) {
  const o = opts || {};
  const file = o.file;
  const now = o.now || (() => Date.now());
  const doFetch = o.fetch || (typeof fetch === 'function' ? fetch : null);
  const run = o.run || runClaudeCode; // the Claude Code CLI runner (injectable for tests)
  const memory = {}; // provider → secrets, when they cannot be encrypted on this PC

  function read() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { active: '', providers: {} }; } }
  function write(d) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(d, null, 1), { mode: 0o600 }); }
  function seal(t) { if (!t || !o.encrypt) return null; try { return o.encrypt(t).toString('base64'); } catch (e) { return null; } }
  function unseal(b) { if (!b || !o.decrypt) return ''; try { return o.decrypt(Buffer.from(b, 'base64')); } catch (e) { return ''; } }

  /** A provider's settings with its secrets, for a call. */
  function full(id) {
    const p = BY_ID[id];
    if (!p) throw new Error('Choose the LLM to use (AI settings).');
    const saved = read().providers[id] || {};
    const c = Object.assign({}, saved);
    p.fields.filter((f) => f.secret).forEach((f) => { c[f.key] = unseal(saved[f.key]) || (memory[id] || {})[f.key] || ''; });
    return c;
  }

  // `max` (a long answer asked for, e.g. Code Fix's edits): more time than a short one
  async function http(method, url, headers, body, max) {
    if (!doFetch) throw new Error('This PC cannot make web calls from the desktop app.');
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const ms = max && max > MAX_TOKENS ? LONG_MS : TIMEOUT_MS;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
    let r;
    try {
      r = await doFetch(url, { method, headers, body, signal: ctrl ? ctrl.signal : undefined });
    } catch (e) {
      throw new Error(/abort/i.test(String(e && e.name) + String(e && e.message)) ? 'No answer in ' + ms / 1000 + ' s.' : 'The call did not go out: ' + ((e && e.message) || e) + ' (check the network or the proxy).');
    } finally { if (timer) clearTimeout(timer); }
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    if (!r.ok) {
      const msg = (json && ((json.error && (json.error.message || json.error)) || json.message)) || text.slice(0, 300) || ('HTTP ' + r.status);
      const why = r.status === 401 || r.status === 403 ? ' (the key was refused: check it, and that it may use this model)' : r.status === 404 ? ' (not found: check the model, the region or the URL)'
        : r.status === 429 ? ' (too many calls, or no credit left on the account)' : '';
      throw new Error('HTTP ' + r.status + ': ' + (typeof msg === 'string' ? msg : JSON.stringify(msg)) + why);
    }
    return json;
  }

  /** OpenAI-style content: the text, then each image as a data URL (vision models). */
  function withImagesOpenAI(user, images) {
    return (images || []).length ? [{ type: 'text', text: user }].concat(images.map((im) => ({ type: 'image_url', image_url: { url: 'data:' + im.mime + ';base64,' + im.base64 } }))) : user;
  }

  // ── Each provider: its models, and one chat call ────────────────────────────────────────────────────────────
  const call = {
    anthropic: {
      async models(c) {
        const j = await http('GET', 'https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': c.key, 'anthropic-version': '2023-06-01' });
        return (j.data || []).map((m) => ({ id: m.id, label: m.display_name ? m.display_name + ' · ' + m.id : m.id }));
      },
      async chat(c, system, user, max, images) {
        const j = await http('POST', 'https://api.anthropic.com/v1/messages', { 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          JSON.stringify({ model: c.model, max_tokens: max || MAX_TOKENS, system, messages: [{ role: 'user', content: (images || []).length
            ? images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.base64 } })).concat([{ type: 'text', text: user }]) : user }] }), max);
        return (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      }
    },
    openai: {
      async models(c) {
        const j = await http('GET', 'https://api.openai.com/v1/models', { authorization: 'Bearer ' + c.key });
        return (j.data || []).filter((m) => /^(gpt|o\d|chatgpt)/i.test(m.id) && !/(audio|realtime|transcribe|tts|image|search|embedding)/i.test(m.id))
          .sort((a, b) => (b.created || 0) - (a.created || 0)).map((m) => ({ id: m.id, label: m.id }));
      },
      async chat(c, system, user, max, images) {
        const j = await http('POST', 'https://api.openai.com/v1/chat/completions', { authorization: 'Bearer ' + c.key, 'content-type': 'application/json' },
          JSON.stringify({ model: c.model, messages: [{ role: 'system', content: system }, { role: 'user', content: withImagesOpenAI(user, images) }], max_completion_tokens: max || MAX_TOKENS * 4 }), max);
        return ((j.choices || [])[0] || {}).message ? j.choices[0].message.content || '' : '';
      }
    },
    gemini: {
      async models(c) {
        const j = await http('GET', 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': c.key });
        return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1)
          .map((m) => ({ id: String(m.name).replace(/^models\//, ''), label: (m.displayName ? m.displayName + ' · ' : '') + String(m.name).replace(/^models\//, '') }));
      },
      async chat(c, system, user, max, images) {
        const j = await http('POST', 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(c.model) + ':generateContent', { 'x-goog-api-key': c.key, 'content-type': 'application/json' },
          JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: (images || []).map((im) => ({ inline_data: { mime_type: im.mime, data: im.base64 } })).concat([{ text: user }]) }], generationConfig: { maxOutputTokens: max || MAX_TOKENS * 4 } }), max);
        const cand = (j.candidates || [])[0];
        return cand && cand.content ? (cand.content.parts || []).map((p) => p.text || '').join('\n') : '';
      }
    },
    custom: {
      base(c) {
        const b = trim(c.baseUrl).replace(/\/+$/, '');
        if (!/^https?:\/\//.test(b)) throw new Error('Give the base URL, e.g. http://localhost:11434/v1.');
        return b;
      },
      auth(c) { return c.key ? { authorization: 'Bearer ' + c.key } : {}; },
      async models(c) {
        const j = await http('GET', this.base(c) + '/models', this.auth(c));
        return ((j && (j.data || j.models)) || []).map((m) => ({ id: m.id || m.name, label: m.id || m.name })).filter((m) => m.id);
      },
      async chat(c, system, user, max, images) {
        const j = await http('POST', this.base(c) + '/chat/completions', Object.assign({ 'content-type': 'application/json' }, this.auth(c)),
          JSON.stringify({ model: c.model, messages: [{ role: 'system', content: system }, { role: 'user', content: withImagesOpenAI(user, images) }], max_tokens: max || MAX_TOKENS }), max);
        return ((j.choices || [])[0] || {}).message ? j.choices[0].message.content || '' : '';
      }
    },
    oci: {
      check(c) {
        ['region', 'compartmentId', 'tenancyId', 'userId', 'fingerprint', 'privateKey'].forEach((k) => {
          if (!trim(c[k])) throw new Error('Give the ' + BY_ID.oci.fields.filter((f) => f.key === k)[0].label.toLowerCase() + '.');
        });
        if (!/^[a-z]{2,}-[a-z]+-\d+$/.test(trim(c.region))) throw new Error('The region looks like us-chicago-1.');
      },
      async models(c) {
        this.check(c);
        const url = 'https://generativeai.' + trim(c.region) + '.oci.oraclecloud.com/20231130/models?compartmentId=' + encodeURIComponent(trim(c.compartmentId)) + '&capability=CHAT&lifecycleState=ACTIVE&limit=200';
        const s = ociSign(c, 'GET', url, '', now);
        const j = await http('GET', url, s.headers);
        const seen = {};
        return ((j && j.items) || []).filter((m) => (m.capabilities || ['CHAT']).indexOf('CHAT') !== -1)
          .map((m) => ({ id: m.displayName || m.id, label: (m.vendor ? m.vendor + ' · ' : '') + (m.displayName || m.id) }))
          .filter((m) => (seen[m.id] ? false : (seen[m.id] = true)));
      },
      async chat(c, system, user, max, images) {
        this.check(c);
        const url = 'https://inference.generativeai.' + trim(c.region) + '.oci.oraclecloud.com/20231130/actions/chat';
        const cohere = /^cohere\./i.test(c.model);
        const body = JSON.stringify({
          compartmentId: trim(c.compartmentId),
          servingMode: { servingType: 'ON_DEMAND', modelId: c.model },
          chatRequest: cohere
            ? { apiFormat: 'COHERE', preambleOverride: system, message: user, maxTokens: max || MAX_TOKENS, temperature: 0 }
            : { apiFormat: 'GENERIC', messages: [{ role: 'SYSTEM', content: [{ type: 'TEXT', text: system }] }, { role: 'USER', content: [{ type: 'TEXT', text: user }].concat((images || []).map((im) => ({ type: 'IMAGE', imageUrl: { url: 'data:' + im.mime + ';base64,' + im.base64 } }))) }], maxTokens: max || MAX_TOKENS, temperature: 0 }
        });
        const s = ociSign(c, 'POST', url, body, now);
        const j = await http('POST', url, s.headers, body, max);
        const r = (j && j.chatResponse) || {};
        if (cohere) return r.text || '';
        const ch = (r.choices || [])[0];
        return ch && ch.message ? (ch.message.content || []).map((p) => p.text || '').join('\n') : '';
      }
    },
    claudecode: {
      // No HTTP and no key: shell out to the locally-installed Claude Code CLI, which runs on the user's subscription.
      async models() {
        // Claude Code accepts short aliases, so no model id is pinned here; blank = whatever Claude Code is set to.
        return [{ id: '', label: 'Default (your Claude Code setting)' }, { id: 'sonnet', label: 'Sonnet' }, { id: 'opus', label: 'Opus' }, { id: 'haiku', label: 'Haiku' }];
      },
      async chat(c, system, user, max, images) {
        // with images (Code Fix's screenshots): the message as stream-json, its image blocks inline; the answer is the
        // "result" line of the stream
        const withImages = (images || []).length > 0;
        const args = withImages ? ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'] : ['-p', '--output-format', 'text'];
        if (trim(c.model)) { args.push('--model', trim(c.model)); }
        if (trim(system)) { args.push('--append-system-prompt', system); }
        const input = withImages ? JSON.stringify({ type: 'user', message: { role: 'user', content: images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.base64 } })).concat([{ type: 'text', text: user }]) } }) + '\n' : user;
        const r = await run(args, input, max && max > MAX_TOKENS ? LONG_MS : undefined);
        if (withImages && r && r.code === 0) {
          const res = String(r.stdout || '').split('\n').map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter((x) => x && x.type === 'result').pop();
          if (!res) throw new Error('Claude Code gave no answer.');
          if (res.is_error) throw new Error('Claude Code: ' + String(res.result || res.subtype || 'an error').slice(0, 300));
          return String(res.result || '').trim();
        }
        if (!r || r.code !== 0) {
          const se = String((r && r.stderr) || '').trim();
          const hint = /enoent|not found|not recognized|no such file/i.test(se) || (r && r.code === -1)
            ? ' Install Claude Code and run "claude" once to sign in.' : '';
          throw new Error('Claude Code did not answer' + (se ? ': ' + se.slice(0, 200) : '') + '.' + hint);
        }
        return String((r && r.stdout) || '').trim();
      }
    }
  };

  const store = {
    PROVIDERS,
    settings() {
      const d = read();
      const providers = {};
      PROVIDERS.forEach((p) => {
        const s = d.providers[p.id] || {};
        const pub = { model: s.model || '' };
        p.fields.forEach((f) => {
          if (f.secret) pub['has_' + f.key] = !!(s[f.key] || (memory[p.id] || {})[f.key]);
          else pub[f.key] = s[f.key] || '';
        });
        pub.hasKey = p.fields.filter((f) => f.secret && f.key !== 'passphrase').every((f) => pub['has_' + f.key]) || p.id === 'custom';
        providers[p.id] = pub;
      });
      return { active: d.active || '', providers, keychain: !!o.encrypt,
        catalog: PROVIDERS.map((p) => ({ id: p.id, label: p.label, note: p.note, fields: p.fields.map((f) => ({ key: f.key, label: f.label, secret: !!f.secret, hint: f.hint || '', area: !!f.area })) })) };
    },
    save(x) {
      const p = BY_ID[x && x.provider];
      if (!p) throw new Error('Choose the LLM to use.');
      const d = read();
      const old = d.providers[p.id] || {};
      const rec = { model: trim(x.model) || old.model || '' };
      const mem = memory[p.id] = memory[p.id] || {};
      p.fields.forEach((f) => {
        const v = x[f.key];
        if (f.secret) {
          if (trim(v)) { const sealed = seal(String(v).trim()); rec[f.key] = sealed; mem[f.key] = sealed ? '' : String(v).trim(); } else rec[f.key] = old[f.key] || null;
        } else rec[f.key] = v === undefined ? old[f.key] || '' : trim(v); // a field not sent keeps its saved value
      });
      d.providers[p.id] = rec;
      d.active = p.id;
      write(d);
      return { saved: p.id, keptIn: o.encrypt ? 'keychain' : 'this run' };
    },
    // Desktop-internal only (never wired to a page): a stored secret, so another desktop feature can reuse a key the
    // person already set here — e.g. the OpenAI key for transcribing a recording (lib/transcribe.js).
    secretFor(id, field) { try { return full(id)[field || 'key'] || ''; } catch (e) { return ''; } },
    forget(id) {
      const d = read();
      delete d.providers[id];
      delete memory[id];
      if (d.active === id) d.active = '';
      write(d);
      return { forgotten: id };
    },
    async models(id) {
      const t0 = now();
      try {
        const c = full(id);
        const list = await call[id].models(c);
        return { ok: true, models: list, ms: now() - t0 };
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e), models: [], ms: now() - t0 };
      }
    },
    async ask(q) {
      const d = read();
      const id = (q && q.provider) || d.active;
      const p = BY_ID[id];
      if (!p) throw new Error('Choose the LLM to use first (AI settings).');
      const c = full(id);
      if (!trim(c.model) && id !== 'claudecode') throw new Error('Choose a model for ' + p.label + ' (AI settings, Load models).');
      if (!trim(q.question)) throw new Error('Write what you want to see, in plain words.');
      const t0 = now();
      const up = userPrompt(q);
      const answer = await call[id].chat(c, SYSTEM, up.text);
      const parsed = parseAnswer(answer);
      return Object.assign({ ok: !!parsed.sql, provider: p.label, model: c.model, ms: now() - t0, sent: { tables: up.tables, chars: up.text.length } }, parsed);
    },
    // A plain chat turn — no schema, no SQL parsing — for features that just need the LLM to rewrite or format text, e.g.
    // EquipRite Next's Minutes page ("Format by AI"). Same active provider, key and HTTP plumbing as ask().
    async chat(req) {
      const id = read().active;
      const p = BY_ID[id];
      if (!p) return { ok: false, error: 'Choose the LLM to use (AI settings).' };
      const t0 = now();
      try {
        const c = full(id);
        if (!trim(c.model) && id !== 'claudecode') return { ok: false, error: 'Choose a model for ' + p.label + ' (AI settings, Load models).' };
        const user = String((req && req.user) || '');
        if (!trim(user)) return { ok: false, error: 'There is nothing to send.' };
        const system = trim(req && req.system) || 'You are a helpful assistant.';
        const max = Math.min(MAX_ASK, Math.max(0, Number(req && req.maxTokens) || 0)) || undefined;
        // images (Code Fix's screenshots): [{ mime, base64 }], png/jpeg/webp/gif only
        const images = (Array.isArray(req && req.images) ? req.images : []).filter((im) => im && /^image\/(png|jpeg|webp|gif)$/.test(im.mime) && im.base64).slice(0, 8);
        const text = await call[id].chat(c, system, user, max, images);
        return { ok: true, text: String(text || ''), provider: p.label, model: c.model, ms: now() - t0 };
      } catch (e) {
        return { ok: false, error: (e && e.message) || String(e), ms: now() - t0 };
      }
    }
  };
  return store;
}

module.exports = { open, PROVIDERS, SYSTEM, schemaText, userPrompt, parseAnswer, ociSign };
