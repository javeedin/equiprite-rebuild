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
 * password, token, secret or API key is masked. Bodies are cut at MAX_BODY.
 *
 *   callEntry(o), consoleEntry(args, url), pageEntry(url)   entries
 *   redactText(text), headersOf(h), bodyText(buf, headers)    what an entry may hold
 *   summary(entries)   { calls, failed, console, errors, pages, shots, first }   (first: where it broke)
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

/** A web service call. */
function callEntry(o) {
  const status = Number(o.status) || 0;
  let url = String(o.url || '');
  try { const u = new URL(url); u.username = ''; u.password = ''; url = u.href.replace(/([?&](?:password|token|api_key|apikey|secret)=)[^&]*/gi, '$1' + MASK); } catch (e) { /* kept as given */ }
  return {
    kind: 'call', t: o.t || Date.now(), app: o.app || '', method: String(o.method || 'GET').toUpperCase(), service: o.service || '', path: o.path || '', url,
    status, ms: Number(o.ms) || 0, failed: !!o.error || status === 0 || status >= 400, error: o.error || '', note: o.note || '',
    reqHeaders: headersOf(o.reqHeaders), reqBody: o.reqBody || '', resHeaders: headersOf(o.resHeaders), resBody: o.resBody || '',
  };
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
    if (c.reqBody) out.push('  Sent:', clip(c.reqBody, 2000).replace(/^/gm, '    '));
    if (c.resBody) out.push('  Answer:', clip(c.resBody, 2000).replace(/^/gm, '    '));
    out.push('');
  });
  if (failed.length > 5) out.push(`…and ${failed.length - 5} more failed calls (see the trace).`, '');
  if (errors.length) {
    out.push(`Console errors (${errors.length}):`);
    errors.slice(0, 8).forEach((e) => out.push(`  ${clock(e.offset)} ${clip(e.message, 400)}${e.source ? `  (${e.source}${e.line ? ':' + e.line : ''})` : ''}`));
    out.push('');
  }
  if (pages.length) out.push(`Pages: ${pages.filter((p, i) => p !== pages[i - 1]).join(' → ')}`);
  out.push(`Calls: ${calls.length} (${failed.length} failed) · console errors: ${errors.length}`);
  return out.join('\n');
}

module.exports = { callEntry, consoleEntry, pageEntry, redactText, headersOf, bodyText, summary, toHar, bugReport, clock, MAX_BODY, MASK };
