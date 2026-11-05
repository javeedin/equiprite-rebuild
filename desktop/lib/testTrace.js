'use strict';
/**
 * The technical trace of a recorded test (Record on a Jira story's panel): what happened underneath while the screen was
 * recorded, so a failure can be traced to the call that broke. Kept next to the recording, one JSON line per event
 * (lib/testEvidence.js), from:
 *
 *   call     every web service call an EquipRite page made through this PC's server (lib/devserver.js proxy): the
 *            method, the service and URL, the status, how long it took, the JSON (or XML) sent and received
 *   console  the pages' console errors and warnings, crashes (desktop/main.js, every EquipRite window)
 *   page     the page the person moved to (main.js)
 *   shot     a screenshot taken while recording
 *
 * Secrets never reach the trace: Authorization, cookies and token headers are dropped, and any field or tag named like a
 * password, token, secret or API key is masked. Bodies are cut at MAX_BODY. A call keeps WHETHER it was authenticated
 * and AS WHOM (auth: the scheme, and for Basic the username) — never the password or token itself, because the trace is
 * saved to disk and shared (the HAR file, the bug report, Jira), where a real credential would leak.
 *
 *   callEntry(o), consoleEntry(args, url), pageEntry(url)   entries
 *   redactText(text), headersOf(h), bodyText(buf, headers)    what an entry may hold
 *   authOf(headers)    { sent, scheme, user }   the login on a call, no secret
 *   summary(entries)   { calls, failed, console, errors, pages, shots, first }   (first: where it broke)
 *   endpoints(entries) [{ service, method, endpoint, calls, failed, statuses, auth, users, maxMs }]   the APIs used
 *   toHar(trace)       a HAR 1.2 file (Chrome DevTools > Network > Import), calls only
 *   bugReport(trace)   the failure in words, ready to paste into Jira
 */
const zlib = require('zlib');

const MAX_BODY = 256 * 1024;
const SECRET = /^(pass(word|wd|phrase)?|secret|client[-_]?secret|token|access[-_]?token|refresh[-_]?token|id[-_]?token|api[-_]?key|apikey|authori[sz]ation|cookie|credentials?|session[-_]?id|jsessionid)$/i;
const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i;
const MASK = '•••';
// What every browser sends: kept out, so what the app itself sent stands out.
const NOISE_HEADER = /^(host|connection|keep-alive|content-length|transfer-encoding|pragma|cache-control|accept-language|accept-encoding|user-agent|origin|referer|dnt|priority|te|upgrade-insecure-requests|sec-[\w-]+)$/i;
const BINARY = /^(image|audio|video|font)\/|application\/(octet-stream|pdf|zip|x-zip|gzip|vnd\.openxmlformats|vnd\.ms-)/i;
const QUIET_CONSOLE = /Electron Security Warning|DevTools failed to load|Download the React DevTools/;

function redactValue(v) {
  if (Array.isArray(v)) return v.map(redactValue);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).forEach((k) => { out[k] = SECRET.test(k) && v[k] != null && typeof v[k] !== 'object' ? MASK : redactValue(v[k]); });
    return out;
  }
  return v;
}

/** A body with its secrets masked: JSON by its field names, XML by its tags, a form by its fields. */
function redactText(text) {
  const s = String(text == null ? '' : text);
  if (!s) return '';
  const t = s.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return JSON.stringify(redactValue(JSON.parse(t)), null, 2); } catch (e) { /* not JSON after all: the patterns below */ }
  }
  return s
    .replace(/("(?:pass(?:word|wd)?|secret|token|access_token|api[-_]?key|authorization)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, '$1"' + MASK + '"')
    .replace(/<((?:\w+:)?(?:password|passwd|secret|token|apiKey|authorization))>[\s\S]*?<\/\1>/gi, '<$1>' + MASK + '</$1>')
    .replace(/(^|[?&])(password|passwd|secret|token|access_token|api_key|apikey)=[^&\s]*/gi, '$1$2=' + MASK);
}

/** The headers worth keeping: secrets dropped, and what every browser sends (user agent, sec-*, encodings…). */
function headersOf(h) {
  const out = {};
  Object.keys(h || {}).forEach((k) => {
    if (SECRET_HEADER.test(k) || NOISE_HEADER.test(k)) return;
    const v = Array.isArray(h[k]) ? h[k].join(', ') : String(h[k]);
    out[k] = /token|secret|key|auth/i.test(k) ? MASK : v;
  });
  return out;
}

/** A body as text for the trace (unzipped when the server zipped it), or a note of what it was. */
function bodyText(buf, headers) {
  if (!buf || !buf.length) return '';
  const h = headers || {};
  const type = String(h['content-type'] || '');
  if (BINARY.test(type)) return `[${type.split(';')[0]}, ${buf.length} bytes]`;
  let b = buf;
  const enc = String(h['content-encoding'] || '').toLowerCase();
  try {
    if (enc === 'gzip') b = zlib.gunzipSync(buf);
    else if (enc === 'deflate') b = zlib.inflateSync(buf);
    else if (enc === 'br') b = zlib.brotliDecompressSync(buf);
  } catch (e) {
    return `[${enc} body that could not be unzipped, ${buf.length} bytes]`;
  }
  const cut = b.length > MAX_BODY;
  return redactText(b.subarray(0, MAX_BODY).toString('utf8')) + (cut ? `\n… cut: ${b.length} bytes in all` : '');
}

/** The login on a call: whether a credential was sent, its scheme, and for Basic the username — never the secret. The
 *  password or token itself is deliberately left out: the trace is saved and shared, and a real credential would leak. */
function authOf(headers) {
  const h = headers || {};
  const raw = h.authorization || h.Authorization || h['proxy-authorization'] || '';
  const str = Array.isArray(raw) ? raw[0] : String(raw || '');
  if (!str) return { sent: false, scheme: '', user: '' };
  const sp = str.indexOf(' ');
  const scheme = (sp === -1 ? str : str.slice(0, sp)) || 'Authorization';
  let user = '';
  if (/^basic$/i.test(scheme) && sp !== -1) {
    try { user = Buffer.from(str.slice(sp + 1).trim(), 'base64').toString('utf8').split(':')[0] || ''; } catch (e) { user = ''; }
  }
  return { sent: true, scheme, user };
}

/** A web service call. */
function callEntry(o) {
  const status = Number(o.status) || 0;
  let url = String(o.url || '');
  try { const u = new URL(url); u.username = ''; u.password = ''; url = u.href.replace(/([?&](?:password|token|api_key|apikey|secret)=)[^&]*/gi, '$1' + MASK); } catch (e) { /* kept as given */ }
  return {
    kind: 'call', t: o.t || Date.now(), app: o.app || '', method: String(o.method || 'GET').toUpperCase(), service: o.service || '', path: o.path || '', url,
    status, ms: Number(o.ms) || 0, failed: !!o.error || status === 0 || status >= 400, error: o.error || '', note: o.note || '',
    auth: o.auth || authOf(o.reqHeaders),
    reqHeaders: headersOf(o.reqHeaders), reqBody: o.reqBody || '', resHeaders: headersOf(o.resHeaders), resBody: o.resBody || '',
  };
}

/** The endpoint a call hit, without the query or ids, so the same API groups together: "/equipmentRequests/{id}/lines". */
function endpointOf(call) {
  let p = String(call.path || '');
  try { p = new URL(call.url).pathname.replace(new RegExp('^/__backend/' + (call.service || '') + '\\b'), '') || p; } catch (e) { p = p.split('?')[0]; }
  p = p.split('?')[0].replace(/\/+$/, '') || '/';
  return p.split('/').map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(seg) ? '{id}' : seg)).join('/');
}

/** The APIs the test used: one row per service + method + endpoint, with how often, how many failed, the statuses seen,
 *  and the login that was used (scheme, and the usernames for Basic) — no secret. Most-called, then failures, first. */
function endpoints(entries) {
  const by = new Map();
  (entries || []).filter((e) => e.kind === 'call').forEach((c) => {
    const endpoint = endpointOf(c);
    const key = (c.service || '') + ' ' + c.method + ' ' + endpoint;
    let g = by.get(key);
    if (!g) { g = { service: c.service || '', method: c.method, endpoint, calls: 0, failed: 0, statuses: [], auth: { sent: false, schemes: [], users: [] }, maxMs: 0, host: '' }; by.set(key, g); }
    g.calls += 1;
    if (c.failed) g.failed += 1;
    if (g.statuses.indexOf(c.status) === -1) g.statuses.push(c.status);
    g.maxMs = Math.max(g.maxMs, c.ms || 0);
    if (!g.host) { try { g.host = new URL(c.url).host; } catch (e) { /* none */ } }
    const a = c.auth || {};
    if (a.sent) { g.auth.sent = true; if (a.scheme && g.auth.schemes.indexOf(a.scheme) === -1) g.auth.schemes.push(a.scheme); if (a.user && g.auth.users.indexOf(a.user) === -1) g.auth.users.push(a.user); }
  });
  return [...by.values()].map((g) => { g.statuses.sort((x, y) => x - y); return g; })
    .sort((a, b) => (b.failed - a.failed) || (b.calls - a.calls) || a.endpoint.localeCompare(b.endpoint));
}

const LEVELS = ['debug', 'info', 'warning', 'error'];
/** A console message from an Electron page (console-message: an event with level/message, or the older positional
 *  arguments), or null when it is not worth keeping (only warnings and errors are). */
function consoleEntry(args, pageUrl) {
  const a = args || [];
  const e = a[0] && typeof a[0] === 'object' ? a[0] : {};
  let level = e.level !== undefined ? e.level : a[1];
  if (typeof level === 'number') level = LEVELS[level] || 'info';
  level = String(level || 'info');
  const message = String(e.message !== undefined ? e.message : (a[2] || ''));
  if ((level !== 'error' && level !== 'warning') || !message || QUIET_CONSOLE.test(message)) return null;
  const line = e.lineNumber !== undefined ? e.lineNumber : a[3];
  const source = String(e.sourceId !== undefined ? e.sourceId : (a[4] || ''));
  return { kind: 'console', t: Date.now(), level, message: message.slice(0, 4000), source: source.replace(/^https?:\/\/[^/]+/, ''), line: Number(line) || 0,
    page: String(pageUrl || '').replace(/^https?:\/\/[^/]+/, '') };
}

/** The page the person moved to (its path on this PC's server). */
function pageEntry(url) {
  return { kind: 'page', t: Date.now(), url: String(url || '').replace(/^https?:\/\/[^/]+/, '') || '/' };
}

function clock(ms) {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  return (s >= 3600 ? Math.floor(s / 3600) + ':' : '') + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

/** The numbers, and where it broke (the first failed call, else the first console error). */
function summary(entries) {
  const list = entries || [];
  const calls = list.filter((e) => e.kind === 'call');
  const failed = calls.filter((e) => e.failed);
  const cons = list.filter((e) => e.kind === 'console');
  const errors = cons.filter((e) => e.level === 'error');
  const firstFail = failed[0] || errors[0] || null;
  return {
    calls: calls.length, failed: failed.length, console: cons.length, errors: errors.length,
    pages: list.filter((e) => e.kind === 'page').length, shots: list.filter((e) => e.kind === 'shot').length,
    first: firstFail ? {
      offset: firstFail.offset || 0, at: clock(firstFail.offset), kind: firstFail.kind,
      text: firstFail.kind === 'call' ? `${firstFail.method} ${firstFail.service} ${firstFail.path} → ${firstFail.status || firstFail.error || 'no answer'}` : firstFail.message.slice(0, 200),
    } : null,
  };
}

function harHeaders(h) { return Object.keys(h || {}).map((k) => ({ name: k, value: String(h[k]) })); }
function bodyOnly(text) { return String(text || '').replace(/\n… cut: \d+ bytes in all$/, ''); }

/** The calls as a HAR 1.2 file: open it in Chrome DevTools (Network, Import HAR) or give it to a developer. */
function toHar(trace) {
  const tr = trace || {};
  const entries = (tr.entries || []).filter((e) => e.kind === 'call').map((c) => {
    let query = [];
    try { query = [...new URL(c.url).searchParams].map(([name, value]) => ({ name, value })); } catch (e) { /* none */ }
    const reqType = (c.reqHeaders && c.reqHeaders['content-type']) || '';
    const resType = (c.resHeaders && c.resHeaders['content-type']) || '';
    return {
      startedDateTime: new Date(c.t).toISOString(), time: c.ms,
      request: { method: c.method, url: c.url, httpVersion: 'HTTP/1.1', headers: harHeaders(c.reqHeaders), queryString: query, cookies: [], headersSize: -1,
        bodySize: c.reqBody ? Buffer.byteLength(c.reqBody) : 0, ...(c.reqBody ? { postData: { mimeType: reqType, text: bodyOnly(c.reqBody) } } : {}) },
      response: { status: c.status, statusText: c.error || '', httpVersion: 'HTTP/1.1', headers: harHeaders(c.resHeaders), cookies: [], redirectURL: '', headersSize: -1,
        bodySize: c.resBody ? Buffer.byteLength(c.resBody) : 0, content: { size: c.resBody ? Buffer.byteLength(c.resBody) : 0, mimeType: resType, text: bodyOnly(c.resBody) } },
      cache: {}, timings: { send: 0, wait: c.ms, receive: 0 }, comment: `${clock(c.offset)} into the recording · ${c.app || ''} · ${c.service}`,
    };
  });
  return { log: { version: '1.2', creator: { name: 'EquipRite Test Evidence', version: '1.0' }, comment: `${tr.key || ''} · ${tr.name || ''}`, pages: [], entries } };
}

function clip(text, n) { const s = String(text || ''); return s.length > n ? s.slice(0, n) + '\n…' : s; }

/** The failure in words, ready to paste into a Jira comment or a bug. */
function bugReport(trace, folder) {
  const tr = trace || {};
  const list = tr.entries || [];
  const s = summary(list);
  const calls = list.filter((e) => e.kind === 'call');
  const failed = calls.filter((e) => e.failed);
  const errors = list.filter((e) => e.kind === 'console' && e.level === 'error');
  const pages = list.filter((e) => e.kind === 'page').map((p) => p.url);
  const out = [];
  out.push(`Tested ${tr.key || ''}${tr.start ? ' on ' + new Date(tr.start).toISOString().slice(0, 16).replace('T', ' ') : ''} (EquipRite desktop app, recorded)`);
  out.push(`Recording: ${folder ? folder + '/' : ''}${tr.name || ''}${s.first ? `  (where it broke: ${s.first.at})` : ''}`);
  out.push('');
  if (!failed.length && !errors.length) out.push(`Nothing failed: ${calls.length} web service calls, all answered.`);
  failed.slice(0, 5).forEach((c, i) => {
    out.push(`${i === 0 ? 'What failed' : 'Also failed'} (${clock(c.offset)} into the recording):`);
    out.push(`  ${c.method} ${c.url} → ${c.status || 'no answer'}${c.error ? ' ' + c.error : ''} (${c.ms} ms)`);
    out.push(`  Login sent: ${authText(c.auth)}`);
    if (c.reqBody) out.push('  Sent:', clip(c.reqBody, 2000).replace(/^/gm, '    '));
    if (c.resBody) out.push('  Answer:', clip(c.resBody, 2000).replace(/^/gm, '    '));
    out.push('');
  });
  if (failed.length > 5) out.push(`…and ${failed.length - 5} more failed calls (see the trace).`, '');
  const apis = endpoints(list);
  if (apis.length) {
    out.push(`APIs used (${apis.length}):`);
    apis.slice(0, 40).forEach((g) => out.push(`  ${g.method} ${g.service ? g.service + ' ' : ''}${g.endpoint} · ${g.calls}×${g.failed ? ', ' + g.failed + ' failed' : ''} · ${g.statuses.join('/')} · login ${authText({ sent: g.auth.sent, scheme: g.auth.schemes[0], user: g.auth.users[0] })}${g.auth.users.length > 1 ? ' +' + (g.auth.users.length - 1) : ''}`));
    out.push('');
  }
  if (errors.length) {
    out.push(`Console errors (${errors.length}):`);
    errors.slice(0, 8).forEach((e) => out.push(`  ${clock(e.offset)} ${clip(e.message, 400)}${e.source ? `  (${e.source}${e.line ? ':' + e.line : ''})` : ''}`));
    out.push('');
  }
  if (pages.length) out.push(`Pages: ${pages.filter((p, i) => p !== pages[i - 1]).join(' → ')}`);
  out.push(`Calls: ${calls.length} (${failed.length} failed) · console errors: ${errors.length}`);
  return out.join('\n');
}

/** The login on a call, in words, for the viewer and the report: "as priya.raman (Basic)", "Bearer token", or "none". */
function authText(a) {
  if (!a || !a.sent) return 'none';
  if (a.user) return 'as ' + a.user + (a.scheme ? ' (' + a.scheme + ')' : '');
  return (a.scheme || 'Authorization') + ' token';
}

module.exports = { callEntry, consoleEntry, pageEntry, redactText, headersOf, bodyText, authOf, authText, endpointOf, endpoints, summary, toHar, bugReport, clock, MAX_BODY, MASK };
