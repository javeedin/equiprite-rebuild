'use strict';
/**
 * Standup minutes, for the Minutes page in EquipRite Next: the daily standup on the Jira backlog, written down and kept
 * in DuckDB in this app's data folder (minutes.duckdb). Each meeting has a header (date, time, title, customer,
 * attendees) and lines (each a note, tied to a Jira story by its key or left generic, with a next action, owner and due
 * date). Tracking rolls the lines up by the story's epic and by customer (the page joins to the Jira backlog it read).
 *
 * The data is real DuckDB tables you can query (as EquipRite Future does, lib/futureDb.js):
 *   - meetings        (id, date, time, title, customer, attendees JSON, context, created_at, updated_at)
 *   - minute_lines    (id, meeting_id, seq, jira_key, generic, text, raw, action, owner, due, status)
 *   - minute_settings (id='current', teams_webhook sealed, default_attendees JSON, org_name, from_name, from_email)
 * When DuckDB cannot load (no binary for this platform), the same store keeps the data in a JSON file beside it.
 *
 *   open({ file, encrypt, decrypt, transcribe, fetch }) → store (every method async)
 *   settings()                 { ok, teamsWebhookSet, defaultAttendees, orgName, fromName, fromEmail }  (never the webhook URL)
 *   saveSettings(s)            { teamsWebhook?, clearTeamsWebhook?, defaultAttendees?, orgName?, fromName?, fromEmail? } → settings()
 *   list()                     { ok, meetings: [summary] } newest first (id, date, time, title, customer, attendees,
 *                              keys, lineCount, actionOpen, updatedAt)
 *   get(id)                    { ok, meeting } | { ok:false }
 *   save(meeting)              upsert (ids + timestamps filled) → { ok, meeting }
 *   remove(id)                 { ok }
 *   dictate({ audioBase64, mime })   voice → text through Whisper (lib/transcribe.js) → { ok, text, segments } | { ok:false, error }
 *   sendTeams({ card, text })  POST to the saved Teams Incoming Webhook → { ok, status } | { ok:false, error }
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

let duck = null;
try { duck = require('@duckdb/node-api'); } catch (e) { duck = null; }

const EXT = { 'audio/webm': '.webm', 'video/webm': '.webm', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav',
  'audio/wave': '.wav', 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.m4a' };

function rid(prefix) { return prefix + Date.now().toString(36) + crypto.randomBytes(4).toString('hex'); }
function str(v) { return v == null ? '' : String(v); }
function arr(v) { return Array.isArray(v) ? v.filter((x) => str(x).trim()).map((x) => str(x).trim()) : []; }
function jarr(text) { try { const a = JSON.parse(text); return Array.isArray(a) ? a : []; } catch (e) { return []; } }

function cleanLine(l) {
  l = l || {};
  const key = str(l.jiraKey).trim().toUpperCase();
  return { id: str(l.id) || rid('l_'), jiraKey: key, generic: !key, text: str(l.text), raw: str(l.raw),
    action: str(l.action), owner: str(l.owner), due: str(l.due), status: l.status === 'done' ? 'done' : 'open' };
}
function cleanMeeting(m) {
  m = m || {};
  return { id: str(m.id), date: str(m.date), time: str(m.time), title: str(m.title), customer: str(m.customer),
    attendees: arr(m.attendees), context: str(m.context), lines: Array.isArray(m.lines) ? m.lines.map(cleanLine) : [],
    createdAt: m.createdAt || null, updatedAt: m.updatedAt || null };
}
function summaryOf(m) {
  const keys = [];
  (m.lines || []).forEach((l) => { const k = str(l.jiraKey).trim(); if (k && keys.indexOf(k) === -1) keys.push(k); });
  return { id: m.id, date: m.date, time: m.time, title: m.title, customer: m.customer, attendees: m.attendees || [],
    keys: keys, lineCount: (m.lines || []).length, actionOpen: (m.lines || []).filter((l) => str(l.action).trim() && l.status !== 'done').length,
    updatedAt: m.updatedAt || null };
}
const byNewest = (a, b) => str(b.updatedAt).localeCompare(str(a.updatedAt)) || str(b.date).localeCompare(str(a.date));

// Voice → text, independent of where meetings are stored.
async function doDictate(transcribe, b) {
  if (!transcribe) return { ok: false, error: 'Transcription is not set up.' };
  b = b || {};
  const base64 = str(b.audioBase64).replace(/^data:[^,]*,/, '');
  if (!base64) return { ok: false, error: 'No audio was received.' };
  const tmp = path.join(os.tmpdir(), rid('eqp-min-') + (EXT[str(b.mime).toLowerCase()] || '.webm'));
  try {
    fs.writeFileSync(tmp, Buffer.from(base64, 'base64'));
    const r = await transcribe.transcribe(tmp, {});
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'Could not transcribe.', setup: r && r.setup };
    const text = (r.segments || []).map((s) => str(s.text).trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return { ok: true, text: text, segments: r.segments || [], engine: r.engine, lang: r.lang };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { /* already gone */ }
  }
}

// POST a message to a Teams incoming webhook, independent of where the webhook is kept.
async function postTeams(doFetch, url, b) {
  if (!url) return { ok: false, error: 'No Teams webhook set. Add it in Minutes settings.' };
  if (!doFetch) return { ok: false, error: 'Sending is not available in this app.' };
  b = b || {};
  const payload = b.card ? b.card : { text: str(b.text) };
  try {
    const resp = await doFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const status = resp && typeof resp.status === 'number' ? resp.status : 0;
    if (status >= 200 && status < 300) return { ok: true, status };
    let detail = '';
    try { detail = (await resp.text()).slice(0, 200); } catch (e) { /* no body */ }
    return { ok: false, status, error: 'Teams refused the message (HTTP ' + status + ')' + (detail ? ': ' + detail : '') };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

/** The store, backed by real DuckDB tables. */
async function duckStore(o, file) {
  const encrypt = o.encrypt || null;
  const decrypt = o.decrypt || null;
  const transcribe = o.transcribe || null;
  const doFetch = o.fetch || (typeof fetch === 'function' ? fetch : null);
  let memHook = null;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const instance = await duck.DuckDBInstance.create(file);
  const con = await instance.connect();
  let queue = Promise.resolve();
  const serial = (fn) => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
  const rows = async (sql, params) => (await con.runAndReadAll(sql, params || [])).getRowObjectsJson();

  await con.run('CREATE TABLE IF NOT EXISTS meetings (id VARCHAR PRIMARY KEY, date VARCHAR, time VARCHAR, title VARCHAR, customer VARCHAR, attendees VARCHAR, context VARCHAR, created_at VARCHAR, updated_at VARCHAR)');
  await con.run('CREATE TABLE IF NOT EXISTS minute_lines (id VARCHAR PRIMARY KEY, meeting_id VARCHAR, seq INTEGER, jira_key VARCHAR, generic BOOLEAN, text VARCHAR, raw VARCHAR, action VARCHAR, owner VARCHAR, due VARCHAR, status VARCHAR)');
  await con.run("CREATE TABLE IF NOT EXISTS minute_settings (id VARCHAR PRIMARY KEY, teams_webhook VARCHAR, default_attendees VARCHAR, org_name VARCHAR, from_name VARCHAR, from_email VARCHAR)");
  await con.run('CREATE TABLE IF NOT EXISTS minute_kv (k VARCHAR PRIMARY KEY, v VARCHAR)');

  function seal(t) { if (!t || !encrypt) return null; try { return encrypt(t).toString('base64'); } catch (e) { return null; } }
  function unseal(b) { if (!b || !decrypt) return ''; try { return decrypt(Buffer.from(b, 'base64')); } catch (e) { return ''; } }
  async function settingsRow() { const r = await rows("SELECT * FROM minute_settings WHERE id = 'current'"); return r[0] || {}; }
  async function kvGet(k) { const r = await rows('SELECT v FROM minute_kv WHERE k = $1', [k]); return r[0] ? r[0].v : ''; }
  async function webhook() { if (memHook) return memHook; const s = await settingsRow(); return unseal(s.teams_webhook); }
  async function settings() {
    const s = await settingsRow();
    return { ok: true, teamsWebhookSet: !!(memHook || (s.teams_webhook && unseal(s.teams_webhook))), defaultAttendees: jarr(s.default_attendees),
      orgName: str(s.org_name), fromName: str(s.from_name), fromEmail: str(s.from_email), provider: (await kvGet('provider')) || 'local', keychain: !!encrypt, engine: 'duckdb' };
  }
  function lineToObj(r) {
    return { id: r.id, jiraKey: str(r.jira_key), generic: !!r.generic, text: str(r.text), raw: str(r.raw),
      action: str(r.action), owner: str(r.owner), due: str(r.due), status: r.status === 'done' ? 'done' : 'open' };
  }
  function meetingToObj(r, lineRows) {
    return { id: r.id, date: str(r.date), time: str(r.time), title: str(r.title), customer: str(r.customer),
      attendees: jarr(r.attendees), context: str(r.context), lines: (lineRows || []).map(lineToObj),
      createdAt: r.created_at || null, updatedAt: r.updated_at || null };
  }

  return {
    engine: 'duckdb',
    settings: () => serial(settings),
    saveSettings: (b) => serial(async () => {
      b = b || {};
      const s = await settingsRow();
      let hook = s.teams_webhook || null;
      if (b.clearTeamsWebhook) { hook = null; memHook = null; }
      else if (str(b.teamsWebhook).trim()) {
        const url = str(b.teamsWebhook).trim();
        if (!/^https:\/\//i.test(url)) throw new Error('The Teams webhook must be an https:// URL.');
        if (encrypt) { hook = seal(url); memHook = null; } else { hook = null; memHook = url; }
      }
      const def = b.defaultAttendees !== undefined ? JSON.stringify(arr(b.defaultAttendees)) : (s.default_attendees || '[]');
      const org = b.orgName !== undefined ? str(b.orgName) : str(s.org_name);
      const fn = b.fromName !== undefined ? str(b.fromName) : str(s.from_name);
      const fe = b.fromEmail !== undefined ? str(b.fromEmail) : str(s.from_email);
      await con.run("INSERT OR REPLACE INTO minute_settings VALUES ('current', $1, $2, $3, $4, $5)", [hook, def, org, fn, fe]);
      if (b.provider !== undefined) await con.run("INSERT OR REPLACE INTO minute_kv VALUES ('provider', $1)", [String(b.provider)]);
      return await settings();
    }),
    list: () => serial(async () => {
      const ms = await rows('SELECT * FROM meetings');
      const ls = await rows('SELECT * FROM minute_lines ORDER BY seq');
      const byM = {};
      ls.forEach((l) => { (byM[l.meeting_id] = byM[l.meeting_id] || []).push(l); });
      const out = ms.map((r) => {
        const m = meetingToObj(r, byM[r.id] || []);
        return Object.assign(summaryOf(m), { lines: m.lines });
      }).sort(byNewest);
      return { ok: true, meetings: out };
    }),
    get: (id) => serial(async () => {
      const mr = await rows('SELECT * FROM meetings WHERE id = $1', [str(id)]);
      if (!mr.length) return { ok: false };
      const lr = await rows('SELECT * FROM minute_lines WHERE meeting_id = $1 ORDER BY seq', [str(id)]);
      return { ok: true, meeting: meetingToObj(mr[0], lr) };
    }),
    save: (b) => serial(async () => {
      const m = cleanMeeting(b);
      const now = new Date().toISOString();
      let created = now;
      if (m.id) { const ex = await rows('SELECT created_at FROM meetings WHERE id = $1', [m.id]); if (ex.length) created = ex[0].created_at || m.createdAt || now; else created = m.createdAt || now; }
      else m.id = rid('m_');
      m.createdAt = created; m.updatedAt = now;
      await con.run('BEGIN TRANSACTION');
      try {
        await con.run('INSERT OR REPLACE INTO meetings VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          [m.id, m.date, m.time, m.title, m.customer, JSON.stringify(m.attendees), m.context, m.createdAt, m.updatedAt]);
        await con.run('DELETE FROM minute_lines WHERE meeting_id = $1', [m.id]);
        for (let i = 0; i < m.lines.length; i++) {
          const l = m.lines[i];
          await con.run('INSERT INTO minute_lines VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
            [l.id, m.id, i, l.jiraKey, l.generic, l.text, l.raw, l.action, l.owner, l.due, l.status]);
        }
        await con.run('COMMIT');
      } catch (e) {
        await con.run('ROLLBACK').catch(() => {});
        throw e;
      }
      return { ok: true, meeting: m };
    }),
    remove: (id) => serial(async () => {
      await con.run('DELETE FROM minute_lines WHERE meeting_id = $1', [str(id)]);
      await con.run('DELETE FROM meetings WHERE id = $1', [str(id)]);
      return { ok: true };
    }),
    dictate: (b) => doDictate(transcribe, b),
    sendTeams: (b) => serial(async () => postTeams(doFetch, await webhook(), b)),
    close: async () => { try { con.closeSync && con.closeSync(); } catch (e) { /* closing */ } try { instance.closeSync && instance.closeSync(); } catch (e) { /* closing */ } }
  };
}

/** The same store kept in a JSON file, used when DuckDB cannot load on this computer. */
function jsonStore(o, file) {
  const encrypt = o.encrypt || null;
  const decrypt = o.decrypt || null;
  const transcribe = o.transcribe || null;
  const doFetch = o.fetch || (typeof fetch === 'function' ? fetch : null);
  let memHook = null;

  let data = { settings: {}, meetings: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    data = Object.assign({ settings: {}, meetings: [] }, parsed);
    if (!Array.isArray(data.meetings)) data.meetings = [];
    if (!data.settings || typeof data.settings !== 'object') data.settings = {};
  } catch (e) { /* first run */ }

  function write() { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 1), { mode: 0o600 }); }
  function webhook() { if (memHook) return memHook; const b = data.settings.teamsWebhook; if (!b || !decrypt) return ''; try { return decrypt(Buffer.from(b, 'base64')); } catch (e) { return ''; } }
  function settings() {
    const s = data.settings || {};
    return { ok: true, teamsWebhookSet: !!webhook(), defaultAttendees: arr(s.defaultAttendees), orgName: str(s.orgName),
      fromName: str(s.fromName), fromEmail: str(s.fromEmail), provider: str(s.provider) || 'local', keychain: !!encrypt, engine: 'json' };
  }
  return {
    engine: 'json',
    async settings() { return settings(); },
    async saveSettings(b) {
      b = b || {};
      const s = data.settings || (data.settings = {});
      if (b.clearTeamsWebhook) { delete s.teamsWebhook; memHook = null; }
      else if (str(b.teamsWebhook).trim()) {
        const url = str(b.teamsWebhook).trim();
        if (!/^https:\/\//i.test(url)) throw new Error('The Teams webhook must be an https:// URL.');
        if (encrypt) { s.teamsWebhook = encrypt(url).toString('base64'); memHook = null; } else { delete s.teamsWebhook; memHook = url; }
      }
      if (b.defaultAttendees !== undefined) s.defaultAttendees = arr(b.defaultAttendees);
      if (b.orgName !== undefined) s.orgName = str(b.orgName);
      if (b.fromName !== undefined) s.fromName = str(b.fromName);
      if (b.fromEmail !== undefined) s.fromEmail = str(b.fromEmail);
      if (b.provider !== undefined) s.provider = str(b.provider);
      write();
      return settings();
    },
    async list() { return { ok: true, meetings: data.meetings.map((m) => Object.assign(summaryOf(m), { lines: m.lines || [] })).sort(byNewest) }; },
    async get(id) { const m = data.meetings.find((x) => x.id === id); return m ? { ok: true, meeting: m } : { ok: false }; },
    async save(b) {
      const m = cleanMeeting(b);
      const now = new Date().toISOString();
      const at = m.id ? data.meetings.findIndex((x) => x.id === m.id) : -1;
      if (!m.id) m.id = rid('m_');
      m.createdAt = (at === -1 ? (m.createdAt || now) : (data.meetings[at].createdAt || now));
      m.updatedAt = now;
      if (at === -1) data.meetings.push(m); else data.meetings[at] = m;
      write();
      return { ok: true, meeting: m };
    },
    async remove(id) { data.meetings = data.meetings.filter((x) => x.id !== id); write(); return { ok: true }; },
    dictate(b) { return doDictate(transcribe, b); },
    sendTeams(b) { return postTeams(doFetch, webhook(), b); },
    async close() {}
  };
}

async function open(o) {
  o = o || {};
  const file = o.file;
  let store;
  if (!duck) store = jsonStore(o, file.replace(/\.duckdb$/, '') + '.json');
  else {
    try { store = await duckStore(o, file); }
    catch (e) { console.warn('[minutes] DuckDB could not open', file, e && e.message); store = jsonStore(o, file.replace(/\.duckdb$/, '') + '.json'); }
  }
  const contactsReader = o.contacts || null;   // Outlook contacts (lib/outlookContacts.js read) — local provider
  const outlookSend = o.outlookSend || null;    // Outlook compose (lib/outlookContacts.js compose) — local provider
  const graph = o.graph || null;                // Microsoft 365 (lib/graph.js) — o365 provider

  async function provider() { try { return (await store.settings()).provider || 'local'; } catch (e) { return 'local'; } }

  async function localContacts(q) {
    if (!contactsReader) return { ok: false, available: false, contacts: [] };
    let r;
    try { r = await contactsReader(); } catch (e) { return { ok: false, available: true, contacts: [], error: String((e && e.message) || e) }; }
    if (!r || !r.ok) return r || { ok: false, available: false, contacts: [] };
    const qq = str(q).toLowerCase();
    const list = qq ? (r.contacts || []).filter((c) => (str(c.name) + ' ' + str(c.email)).toLowerCase().indexOf(qq) !== -1) : (r.contacts || []);
    return { ok: true, available: true, contacts: list.slice(0, 100) };
  }

  // Attendee suggestions: from Microsoft 365 (Graph: relevant people + the directory) whenever signed in — being signed
  // in means the user wants it, so we don't depend on the provider toggle — else from local Outlook.
  store.contacts = async (q) => {
    if (graph && graph.status().signedIn) {
      const r = await graph.people(q);
      return { ok: !!(r && r.ok), available: true, contacts: (r && r.contacts) || [], error: r && r.error };
    }
    return localContacts(q);
  };
  // Open the minutes in a pre-filled Outlook message (local provider).
  store.sendOutlook = async (b) => {
    if (!outlookSend) return { ok: false, available: false, error: 'Sending via Outlook is not available in this app.' };
    try { return await outlookSend(b || {}); } catch (e) { return { ok: false, available: true, error: String((e && e.message) || e) }; }
  };
  // Send the minutes: Microsoft 365 (Graph sendMail, actually sends) whenever signed in, else open a pre-filled Outlook message.
  store.sendMail = async (b) => {
    if (graph && graph.status().signedIn) return graph.sendMail(b || {});
    return store.sendOutlook(b || {});
  };
  // Send a test email to the signed-in account, to confirm Microsoft 365 sending works (uses Graph directly, whatever
  // the saved provider is — the user has just signed in and wants to check Mail.Send).
  store.graphTest = async (b) => {
    if (!(graph && graph.status().signedIn)) return { ok: false, error: 'Sign in to Microsoft 365 first.' };
    const to = str((b && b.to) || graph.status().account).trim();
    if (!to) return { ok: false, error: 'Could not find your account email.' };
    const html = '<div style="font-family:\'Segoe UI\',Arial,sans-serif;color:#1f2937;"><p>This is a test email from <b>EquipRite</b>.</p>'
      + '<p>Microsoft 365 sending works ✓ — you can now send standup minutes and follow-ups from EquipRite.</p></div>';
    const r = await graph.sendMail({ to: to, subject: 'EquipRite — Microsoft 365 test', html: html });
    return r && r.ok ? { ok: true, to: to } : (r || { ok: false, error: 'Could not send the test email.' });
  };
  // Send an arbitrary email through Microsoft 365 (Graph) — used by the Jira "Send via Microsoft 365" follow-up, which
  // reuses the Minutes M365 sign-in. Needs recipients and a signed-in account.
  store.graphSend = async (b) => {
    if (!(graph && graph.status().signedIn)) return { ok: false, error: 'Sign in to Microsoft 365 in Minutes settings first.' };
    b = b || {};
    if (!str(b.to).trim()) return { ok: false, error: 'Add recipients (To) before sending.' };
    return graph.sendMail({ to: b.to, cc: b.cc, subject: b.subject, html: b.html });
  };
  // Microsoft 365 account management (lib/graph.js).
  store.graphStatus = () => (graph ? graph.status() : { configured: false, signedIn: false, available: false });
  store.graphPoll = async () => (graph && graph.graphPoll ? graph.graphPoll() : store.graphStatus());
  store.graphConfig = async (b) => { if (graph) graph.saveConfig(b || {}); return { ok: true, status: store.graphStatus() }; };
  store.graphBegin = async () => (graph ? graph.beginSignIn() : { ok: false, error: 'Microsoft 365 is not available in this app.' });
  store.graphInteractive = async () => (graph && graph.signInInteractive ? graph.signInInteractive() : { ok: false, error: 'In-app sign-in is not available in this app.' });
  store.graphSignOut = async () => { if (graph) graph.signOut(); return { ok: true, status: store.graphStatus() }; };
  return store;
}

module.exports = { open, available: !!duck };
