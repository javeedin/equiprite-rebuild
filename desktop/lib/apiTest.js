'use strict';

/**
 * The API tester (Build.Rite → Application pages → a page → Integrations → Test): calls one of the page's REST
 * endpoints, or runs one of its BI Publisher reports, against the real backend — through this server's own
 * /__backend proxy (desktop/lib/devserver.js), so it goes exactly where the app's own calls go, with the same login.
 *
 *   op(endpoint)    what to send, from services/<service>/openapi3.json: its parameters (path, query, header — type,
 *                   required, choices, default), a body to start from (its example, or one shaped from its schema),
 *                   whether it only reads, the backend it goes to and with which login
 *   report(r)       the same for a BI Publisher report of the page: its path and parameters (P_…), sent as the SOAP
 *                   envelope the app sends (bipService/runBIPReport)
 *   run(request)    sends it — a call that changes data only once confirmed — and reads the answer: status, time,
 *                   size, headers; JSON pretty and as a table of its rows; a report's rows decoded from reportBytes;
 *                   and its shape compared with the example response saved with the service connection (what the
 *                   page was built against): fields gone, fields whose type changed, new fields
 *   check(list)     every call of the page that only reads, with the values last used — the page's API health. The
 *                   calls that need nothing run first; a value they answer (an id) fills a call that needs it.
 *   reports(files)  the page's BI Publisher reports, read from its code: path, parameters, row element
 *
 * Kept on this PC only (the repository is public, and answers hold live data): the values last used for each call,
 * its last runs, and values seen in answers (offered for parameters of the same name). Plain Node, no dependencies.
 */
const fs = require('fs');
const path = require('path');
const { STATUS_CODES } = require('http');

const SHOW = 400 * 1024; // the body text shown
const ROWS = 100; // table rows shown (drawn as a table in the page)
const COLS = 40;
const HISTORY = 20; // runs kept per call
const SEEN_VALUES = 8; // values kept per field seen in an answer
const SEEN_KEYS = 400;
const KEEP_BODY = 32 * 1024; // a body remembered
const CHECK_MAX = 80;
const BIP = 'bipService/runBIPReport';
// a name that says nothing of what it is (id, code, …): a value seen for it is kept with the list it came from, and
// offered only to that list's own detail (/equipment-master → /equipment-master/{id}), never to another's
const GENERIC = /^(id|key|code|name|value|type|status|q|uuid)$/;

const str = (v) => (v === undefined || v === null ? '' : String(v));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);
const normKey = (s) => str(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const sizeText = (n) => (n < 1024 ? n + ' B' : n < 1024 * 1024 ? (n / 1024).toFixed(1) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB');
const xmlEsc = (s) => str(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
/** Words saved with a broken encoding (UTF-8 read as Windows-1252: "â€\"" for "—"), put right. */
const fixText = (s) => str(s).replace(/â€”/g, '—').replace(/â€“/g, '–').replace(/â€™/g, '’').replace(/â€˜/g, '‘').replace(/â€œ/g, '“').replace(/â€\u009d/g, '”').replace(/â€¦/g, '…').replace(/Â /g, ' ');
const reEsc = (s) => str(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── the service connections (services/<service>/openapi3.json) ──
const cache = {};
function readJson(f) {
  let st;
  try { st = fs.statSync(f); } catch (e) { return null; }
  const c = cache[f];
  if (c && c.m === st.mtimeMs) return c.v;
  let v = null;
  try { v = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { v = null; }
  cache[f] = { m: st.mtimeMs, v };
  return v;
}

/** Follows a local $ref (#/components/…). */
function deref(spec, x) {
  let v = x;
  let n = 0;
  while (isObj(v) && typeof v.$ref === 'string' && n++ < 10) {
    const m = /^#\/(.+)$/.exec(v.$ref);
    if (!m) return {};
    v = m[1].split('/').reduce((o, k) => (o ? o[k.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), spec) || {};
  }
  return isObj(v) ? v : {};
}

/** A value shaped like the schema: what a body starts from when the service has no example. */
function skeleton(spec, schema, depth) {
  const d = depth || 0;
  const s = deref(spec, schema);
  if (d > 5) return null;
  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (Array.isArray(s.allOf)) return s.allOf.reduce((o, x) => { const v = skeleton(spec, x, d + 1); return isObj(v) ? Object.assign(o, v) : o; }, {});
  const one = (s.oneOf || s.anyOf || [])[0];
  if (one) return skeleton(spec, one, d + 1);
  const t = s.type || (s.properties ? 'object' : s.items ? 'array' : '');
  if (t === 'object') { const o = {}; Object.keys(s.properties || {}).forEach((k) => { o[k] = skeleton(spec, s.properties[k], d + 1); }); return o; }
  if (t === 'array') return [skeleton(spec, s.items || {}, d + 1)];
  if (t === 'integer' || t === 'number') return 0;
  if (t === 'boolean') return false;
  if (t === 'string') return s.format === 'date' ? '2026-01-31' : s.format === 'date-time' ? '2026-01-31T00:00:00Z' : '';
  return null;
}

/** The SOAP envelope the app sends to run a BI Publisher report (as webApps/vbredwoodapp/resources/js/bipLov.js). */
function soapBody(xdoPath, params) {
  const items = (params || []).map((p) => '<pub:item><pub:name>' + xmlEsc(p.name) + '</pub:name><pub:values><pub:item>' + xmlEsc(p.value) + '</pub:item></pub:values></pub:item>').join('');
  return '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:pub="http://xmlns.oracle.com/oxp/service/PublicReportService">'
    + '<soap:Header/><soap:Body><pub:runReport><pub:reportRequest><pub:attributeFormat>xml</pub:attributeFormat>'
    + '<pub:reportAbsolutePath>' + xmlEsc(xdoPath) + '</pub:reportAbsolutePath>'
    + (items ? '<pub:parameterNameValues>' + items + '</pub:parameterNameValues>' : '')
    + '<pub:sizeOfDataChunkDownload>-1</pub:sizeOfDataChunkDownload></pub:reportRequest></pub:runReport></soap:Body></soap:Envelope>';
}

/** The example response saved with the service connection (services/<service>/examples/<operation>/response_*.json). */
function exampleOf(root, svc, id) {
  const dir = path.join(root, 'services', svc, 'examples', id);
  let files;
  try { files = fs.readdirSync(dir).filter((f) => /^response_.*\.json$/.test(f)).sort(); } catch (e) { return null; }
  const f = files.filter((x) => /^response_200/.test(x))[0] || files.filter((x) => /^response_default/.test(x))[0] || files[0];
  if (!f) return null;
  const value = readJson(path.join(dir, f));
  return value === null ? null : { file: ['services', svc, 'examples', id, f].join('/'), value };
}

/** What a call sends, read from its service connection. */
function opOf(root, endpoint) {
  const e = str(endpoint).trim();
  const i = e.indexOf('/');
  const svc = i > 0 ? e.slice(0, i) : '';
  const id = i > 0 ? e.slice(i + 1) : '';
  if (!svc || !id || !/^[\w.-]+$/.test(svc) || /\.\./.test(svc)) return { ok: false, error: 'Not an endpoint: "' + e + '".' };
  const spec = readJson(path.join(root, 'services', svc, 'openapi3.json'));
  if (!spec) return { ok: false, error: 'There is no service "' + svc + '" in services/.' };
  let found = null;
  Object.keys(spec.paths || {}).some((p) => Object.keys(spec.paths[p] || {}).some((m) => {
    const o = spec.paths[p][m];
    if (isObj(o) && o.operationId === id && /^(get|post|put|patch|delete|head)$/.test(m)) { found = { p, m, o, item: spec.paths[p] }; return true; }
    return false;
  }));
  if (!found) return { ok: false, error: 'The service "' + svc + '" has no operation "' + id + '" (renamed?).' };
  const srv = ((spec.servers || [])[0] || {}).url || '';
  const backend = (/backends\/([^/]+)/.exec(srv) || [])[1] || '';
  const params = [];
  const seen = {};
  (found.o.parameters || []).concat(found.item.parameters || []).forEach((x) => {
    const p = deref(spec, x);
    const k = p.in + ':' + p.name;
    if (!p.name || !/^(path|query|header)$/.test(p.in) || seen[k]) return;
    seen[k] = true;
    const sc = deref(spec, p.schema || {});
    params.push({ name: str(p.name), in: p.in, required: p.in === 'path' || !!p.required, type: str(sc.type || 'string'), format: str(sc.format),
      enum: Array.isArray(sc.enum) ? sc.enum.map(str) : [], def: sc.default !== undefined ? str(sc.default) : '', description: fixText(p.description).slice(0, 300),
      example: p.example !== undefined ? str(p.example) : (sc.example !== undefined ? str(sc.example) : '') });
  });
  // a path parameter must be filled, so it comes first; then the required ones (the sort is stable)
  const rank = (p) => (p.in === 'path' ? 0 : p.required ? 1 : 2);
  params.sort((a, b) => rank(a) - rank(b));
  // a placeholder in the path the service does not describe is still a path parameter
  (found.p.match(/\{[^}]+\}/g) || []).map((x) => x.slice(1, -1)).forEach((n) => {
    if (!params.some((p) => p.in === 'path' && p.name === n)) params.unshift({ name: n, in: 'path', required: true, type: 'string', format: '', enum: [], def: '', description: '', example: '' });
  });
  const xvb = found.o['x-vb'] || {};
  const isReport = e === BIP;
  let body = null;
  if (found.o.requestBody) {
    const r = deref(spec, found.o.requestBody);
    const content = r.content || {};
    const ct = Object.keys(content)[0] || 'application/json';
    const c = content[ct] || {};
    let template = '';
    if (isReport) template = soapBody('/Custom/EquipRite/REPORT_NAME_RP.xdo', [{ name: 'P_NAME', value: '' }]);
    else if (c.example !== undefined) template = typeof c.example === 'string' ? c.example : JSON.stringify(c.example, null, 2);
    else if (isObj(c.examples) && Object.keys(c.examples).length) {
      const ex = deref(spec, c.examples[Object.keys(c.examples)[0]]);
      template = typeof ex.value === 'string' ? ex.value : JSON.stringify(ex.value === undefined ? {} : ex.value, null, 2);
    } else if (/json/i.test(ct)) { const sk = skeleton(spec, c.schema || {}, 0); template = JSON.stringify(sk === null ? {} : sk, null, 2); }
    body = { contentType: ct, required: !!r.required, template };
  }
  const hint = str(xvb.actionHint);
  const headers = {};
  Object.keys(xvb.headers || {}).forEach((k) => { headers[k] = str(xvb.headers[k]); });
  const ex = exampleOf(root, svc, id);
  return { ok: true, key: e, endpoint: e, service: svc, operation: id, method: found.m.toUpperCase(), path: found.p, summary: fixText(found.o.summary), description: fixText(found.o.description).slice(0, 600),
    params, body, headers, hint, backend, report: isReport,
    // only reads: GET, VB's getOne/getMany, and a report run (a POST that changes nothing)
    reads: found.m === 'get' || found.m === 'head' || isReport || /^get(One|Many)?$/.test(hint),
    example: ex ? ex.file : '', exampleValue: ex ? ex.value : null };
}

/** The path and query a call goes to, with the values given; the required ones still empty. */
function urlOf(op, v) {
  const vals = (v && v.params) || {};
  const missing = [];
  const q = [];
  const headers = {};
  let p = op.path;
  op.params.forEach((x) => {
    const val = str(vals[x.name]).trim();
    if (!val) { if (x.required) missing.push(x.name); return; }
    if (x.in === 'path') p = p.split('{' + x.name + '}').join(encodeURIComponent(val));
    else if (x.in === 'query') q.push(encodeURIComponent(x.name) + '=' + encodeURIComponent(val));
    else if (x.in === 'header') headers[x.name] = val;
  });
  extraPairs(v && v.extra).forEach((kv) => q.push(encodeURIComponent(kv[0]) + '=' + encodeURIComponent(kv[1])));
  return { path: p, query: q.length ? '?' + q.join('&') : '', headers, missing };
}

/** More parameters typed as "a=1&b=2" (or one per line); already-encoded values are taken as they mean. */
function extraPairs(text) {
  const dec = (s) => { try { return decodeURIComponent(s); } catch (e) { return s; } };
  return str(text).split(/[&\n]/).map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf('=');
    return i < 0 ? [dec(s), ''] : [dec(s.slice(0, i).trim()), dec(s.slice(i + 1).trim())];
  }).filter((x) => x[0]);
}

// ── reading the answer ──
const unxml = (s) => str(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

/** The base64 data of a BI Publisher answer (reportBytes, whatever its namespace prefix). */
function reportBytesOf(text) {
  const m = /<(?:[A-Za-z0-9_]+:)?reportBytes>([\s\S]*?)<\/(?:[A-Za-z0-9_]+:)?reportBytes>/.exec(str(text));
  return m ? m[1].replace(/\s+/g, '') : '';
}

/** The element a report repeats for each row: G_1 when there, else the most repeated element that holds others
 *  (the deeper one on a tie: one row is still its row, not the whole document). */
function rowTagOf(xml) {
  const s = str(xml);
  if (/<G_1[\s>]/.test(s)) return 'G_1';
  const count = {};
  const first = {};
  const re = /<([A-Za-z_][\w.-]*)[\s>]/g;
  let m;
  while ((m = re.exec(s))) { count[m[1]] = (count[m[1]] || 0) + 1; if (first[m[1]] === undefined) first[m[1]] = m.index; }
  const holds = (t) => { const b = new RegExp('<' + reEsc(t) + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + reEsc(t) + '>').exec(s); return !!b && /</.test(b[1]); };
  return Object.keys(count).sort((a, b) => count[b] - count[a] || first[b] - first[a]).filter(holds)[0] || '';
}

/** A report's rows: each row element's simple children as fields. */
function xmlRows(xml, tag) {
  const s = str(xml);
  const t = tag || rowTagOf(s);
  if (!t) return null;
  const re = new RegExp('<' + reEsc(t) + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + reEsc(t) + '>', 'g');
  const rows = [];
  let m;
  while ((m = re.exec(s)) && rows.length < 5000) {
    const row = {};
    const cre = /<([A-Za-z_][\w.-]*)(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/\1>)/g;
    let c;
    while ((c = cre.exec(m[1]))) { if (!/</.test(c[2] || '')) row[c[1]] = unxml(c[2] || ''); }
    rows.push(row);
  }
  return { tag: t, rows };
}

const cell = (x) => (x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x).slice(0, 120) : str(x).slice(0, 300));

/** The rows of an answer, as a table: its list (items, data, …), the columns its records have, the first 200. */
function rowsOf(v) {
  let list = null;
  let from = '';
  if (Array.isArray(v)) { list = v; from = 'the answer'; } else if (isObj(v)) {
    const k = ['items', 'data', 'rows', 'value', 'results', 'records', 'elements'].filter((x) => Array.isArray(v[x]))[0]
      || Object.keys(v).filter((x) => Array.isArray(v[x]) && v[x].some(isObj))[0];
    if (k) { list = v[k]; from = k; } else { list = [v]; from = 'one record'; }
  } else return null;
  const objs = list.filter(isObj);
  let columns;
  let rows;
  if (!objs.length && list.length) { columns = ['value']; rows = list.slice(0, ROWS).map((x) => [cell(x)]); } else {
    columns = [];
    objs.slice(0, 50).forEach((o) => Object.keys(o).forEach((k) => { if (columns.indexOf(k) < 0 && columns.length < COLS) columns.push(k); }));
    rows = objs.slice(0, ROWS).map((o) => columns.map((k) => cell(o[k])));
  }
  const meta = isObj(v) ? ['count', 'totalResults', 'totalCount', 'total', 'hasMore', 'limit', 'offset'].filter((k) => v[k] !== undefined && typeof v[k] !== 'object').map((k) => k + ' ' + v[k]).join(' · ') : '';
  return { from, columns, rows, total: list.length, shown: rows.length, meta };
}

/** Every field path of a value with its type ("data[].id": number); an array's items merged. */
function shapeOf(v, out, prefix, depth) {
  const o = out || {};
  const p = prefix || '';
  const d = depth || 0;
  const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
  if (p && (!o[p] || o[p] === 'null')) o[p] = t; // null says nothing of a field's type
  if (d >= 4) return o;
  if (t === 'array') v.slice(0, 20).forEach((x) => shapeOf(x, o, p + '[]', d + 1));
  else if (t === 'object') Object.keys(v).slice(0, 300).forEach((k) => shapeOf(v[k], o, p ? p + '.' + k : k, d + 1));
  return o;
}

/** The answer against the example the page was built with: fields gone, fields whose type changed, new fields. */
function compareShape(expected, actual) {
  const e = shapeOf(expected);
  const a = shapeOf(actual);
  const parentOf = (k) => { const m = /^(.*?)(\.[^.[\]]+|\[\])$/.exec(k); return m ? m[1] : ''; };
  const missing = [];
  const changed = [];
  const extra = [];
  let empty = false;
  Object.keys(e).forEach((k) => {
    if (k in a) {
      if (e[k] !== a[k] && e[k] !== 'null' && a[k] !== 'null') changed.push(k + ': ' + e[k] + ' → ' + a[k]);
      return;
    }
    // a list with no items: nothing to compare inside it (not gone)
    if (/\[\]$/.test(k) && a[k.slice(0, -2)] === 'array') { empty = true; return; }
    const p = parentOf(k);
    if (!p || p in a) { missing.push(k); return; }
    // inside a list the answer has no items of: nothing to compare (not gone)
    if (/\[\]$/.test(p) && a[p.slice(0, -2)] === 'array') empty = true;
  });
  Object.keys(a).forEach((k) => { if (!(k in e)) { const p = parentOf(k); if (!p || p in e) extra.push(k); } });
  return { status: missing.length || changed.length ? 'differs' : 'same', missing: missing.slice(0, 40), changed: changed.slice(0, 40), extra: extra.slice(0, 40),
    counts: { missing: missing.length, changed: changed.length, extra: extra.length }, empty };
}

/** XML laid out one element a line, indented (for reading; the answer itself is untouched). */
function prettyXml(xml) {
  const s = str(xml).replace(/>\s+</g, '><').trim();
  if (s.length > SHOW) return s;
  let depth = 0;
  return s.replace(/></g, '>\n<').split('\n').map((line) => {
    if (/^<\/[^>]+>$/.test(line)) depth = Math.max(0, depth - 1);
    const out = '  '.repeat(depth) + line;
    if (/^<[^!?/][^>]*>$/.test(line) && !/\/>$/.test(line)) depth++;
    return out;
  }).join('\n');
}

/** The same call as a curl command (the password left out). */
function curlOf(c) {
  const q = (s) => "'" + str(s).replace(/'/g, "'\\''") + "'";
  const parts = ['curl -X ' + c.method + ' ' + q(c.url)];
  Object.keys(c.headers || {}).forEach((k) => parts.push('-H ' + q(k + ': ' + c.headers[k])));
  if (c.user) parts.push('-u ' + q(c.user + ':<password>'));
  if (c.body) parts.push('--data-raw ' + q(c.body.slice(0, 20000)));
  return parts.join(' \\\n  ');
}

/** The answer read: pretty text, its rows as a table, a report's rows decoded, a SOAP fault's reason. */
function decode(res, op) {
  const buf = res.body || Buffer.alloc(0);
  const ct = str((res.headers || {})['content-type']);
  const text = buf.toString('utf8');
  const out = { contentType: ct, pretty: '', table: null, report: null, fault: '', json: undefined, error: '' };
  if (/json/i.test(ct) || /^\s*[[{]/.test(text)) {
    try { out.json = JSON.parse(text); } catch (e) { out.json = undefined; }
  }
  if (out.json !== undefined) {
    out.pretty = JSON.stringify(out.json, null, 2);
    out.table = rowsOf(out.json);
    if (isObj(out.json) && typeof out.json.error === 'string') out.error = out.json.error;
  } else if (/<(?:[A-Za-z0-9_]+:)?reportBytes>/.test(text)) {
    let xml = '';
    try { xml = Buffer.from(reportBytesOf(text), 'base64').toString('utf8'); } catch (e) { xml = ''; }
    const x = xmlRows(xml, op && op.rowTag);
    out.report = { rowTag: x ? x.tag : '', size: xml.length, rows: x ? x.rows.length : 0 };
    if (x) out.table = Object.assign(rowsOf(x.rows), { from: '<' + x.tag + '>' });
    out.pretty = prettyXml(xml);
  } else if (/xml|soap|html/i.test(ct) || /^\s*</.test(text)) {
    const f = /<(?:[A-Za-z0-9_]+:)?(?:Text|faultstring|Reason)[^>]*>([^<]+)</.exec(text);
    if (f && /Fault/.test(text)) out.fault = unxml(f[1]).trim().slice(0, 600);
    out.pretty = /html/i.test(ct) ? text : prettyXml(text);
  } else out.pretty = text;
  return out;
}

/** The page's BI Publisher reports, from its code: each path, the parameters (P_…) given after it, its row element. */
function reportsIn(files) {
  const out = {};
  (files || []).forEach((f) => {
    const s = str(f.text);
    const re = /['"`](\/Custom\/[^'"`\s]+?\/([A-Za-z0-9_]+)\.xdo)['"`]/g;
    let m;
    while ((m = re.exec(s))) {
      const r = out[m[2]] || (out[m[2]] = { name: m[2], path: m[1], params: [], rowTag: '', file: str(f.path) });
      const next = s.indexOf('.xdo', m.index + m[0].length);
      const near = s.slice(m.index, next > 0 ? Math.min(next, m.index + 1200) : m.index + 1200);
      (near.match(/\bP_[A-Z0-9_]+\b/g) || []).forEach((p) => { if (r.params.indexOf(p) < 0) r.params.push(p); });
      const tag = /(?:decodeReportRows|parseXmlRows)\([^,()]+,\s*['"]([A-Za-z0-9_]+)['"]/.exec(near);
      if (tag && !r.rowTag) r.rowTag = tag[1];
    }
  });
  return Object.keys(out).sort().map((k) => out[k]);
}

/** The JavaScript files of a web app (to find a report a page names but whose path is in shared code). */
const jsCache = {};
function appJs(root, app) {
  const dir = path.join(root, 'webApps', app);
  if (jsCache[dir] && Date.now() - jsCache[dir].t < 60000) return jsCache[dir].v;
  const v = [];
  const walk = (d, n) => {
    if (n > 8 || v.length > 4000) return;
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    list.forEach((x) => {
      if (x.isDirectory()) { if (!/^(node_modules|\.|build)/.test(x.name)) walk(path.join(d, x.name), n + 1); } else if (/\.js$/.test(x.name)) v.push(path.join(d, x.name));
    });
  };
  if (/^[\w.-]+$/.test(app)) walk(dir, 0);
  jsCache[dir] = { t: Date.now(), v };
  return v;
}

// ── the store: values last used, runs, values seen (this PC only) ──
function open(o) {
  const opt = o || {};
  const root = opt.root || path.join(__dirname, '..', '..');
  const file = opt.file || '';
  const now = opt.now || (() => new Date());
  const log = opt.log || (() => {});
  let state = { values: {}, history: {}, seen: {} };
  if (file) {
    try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); if (isObj(s)) state = { values: s.values || {}, history: s.history || {}, seen: s.seen || {} }; } catch (e) { /* none yet */ }
  }
  let timer = null;
  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(state));
      fs.renameSync(file + '.tmp', file);
    } catch (e) { log('API tester: could not save ' + file + ': ' + e.message); }
  }
  const save = () => { clearTimeout(timer); timer = setTimeout(flush, 300); if (timer.unref) timer.unref(); };

  /** Values of this field seen in an answer: offered for a parameter of the same name. */
  function learn(table, from, fromPath) {
    if (!table || !table.rows.length) return;
    const at = now().toISOString();
    table.columns.forEach((c, i) => {
      const k = normKey(c);
      const key = GENERIC.test(k) ? (fromPath ? k + '@' + fromPath : '') : k;
      const vals = uniq(table.rows.slice(0, 50).map((r) => r[i]).filter((x) => x !== '' && x.length <= 80)).slice(0, SEEN_VALUES);
      if (key && vals.length) state.seen[key] = { name: c, from, values: vals, at };
    });
    const keys = Object.keys(state.seen);
    if (keys.length > SEEN_KEYS) keys.sort((a, b) => (state.seen[a].at < state.seen[b].at ? -1 : 1)).slice(0, keys.length - SEEN_KEYS).forEach((k) => { delete state.seen[k]; });
  }
  function suggest(params, op) {
    const out = {};
    (params || []).forEach((p) => {
      const k = normKey(p.name);
      const parent = op && p.in === 'path' ? op.path.slice(0, op.path.indexOf('{' + p.name + '}')).replace(/\/$/, '') : '';
      const keys = GENERIC.test(k) ? (parent ? [k + '@' + parent] : []) : [k].concat(/^P_/i.test(p.name) ? [normKey(p.name.slice(2))] : []);
      const hit = keys.map((k) => state.seen[k]).filter(Boolean)[0];
      if (hit) out[p.name] = hit.values.slice(0, 6).map((value) => ({ value, from: hit.from + ' · ' + hit.name }));
    });
    return out;
  }
  function publicOp(op) { const c = Object.assign({}, op); delete c.exampleValue; return c; }
  function describe(op, env) {
    const b = env && env.backend ? env.backend(op.backend) : null;
    return { ok: true, op: publicOp(op),
      backend: b ? { name: op.backend, url: b.url, login: b.login, loginOk: b.loginOk !== false } : { name: op.backend, url: '', login: 'This backend is not in services/catalog.json.', loginOk: false },
      saved: state.values[op.key] || null, history: state.history[op.key] || [], suggest: suggest(op.params, op) };
  }
  /** A report as a call: bipService/runBIPReport with this report's path and parameters. */
  function reportOp(r) {
    const base = opOf(root, BIP);
    if (!base.ok) return base;
    const rp = str(r && r.path).trim();
    if (!/^\/[^<>&]+\.xdo$/.test(rp)) return { ok: false, error: 'Not a report path: "' + rp + '" (/Custom/…/NAME.xdo).' };
    const names = uniq((Array.isArray(r.params) ? r.params : str(r.params).split(',')).map((x) => str(x).trim()).filter((x) => /^[A-Za-z_][\w]*$/.test(x)));
    return Object.assign({}, base, { key: 'report:' + rp, report: true, reportPath: rp, reportName: str(r.name) || path.basename(rp, '.xdo'), rowTag: /^[\w.-]*$/.test(str(r.rowTag)) ? str(r.rowTag) : '',
      summary: 'BI Publisher report ' + (str(r.name) || path.basename(rp, '.xdo')), body: null, example: '', exampleValue: null,
      params: names.map((n) => ({ name: n, in: 'report', required: false, type: 'string', format: '', enum: [], def: '', description: '', example: '' })) });
  }

  function op(endpoint, env) { const x = opOf(root, endpoint); return x.ok ? describe(x, env) : x; }
  function report(r, env) { const x = reportOp(r || {}); return x.ok ? describe(x, env) : x; }

  async function run(req, env) {
    const q = req || {};
    const x = q.report ? reportOp(q.report) : opOf(root, q.endpoint);
    if (!x.ok) return x;
    const values = { params: isObj(q.params) ? q.params : {}, extra: str(q.extra).slice(0, 4000), body: str(q.body) };
    const headers = Object.assign({}, x.headers);
    const hasHeader = (n) => Object.keys(headers).some((h) => h.toLowerCase() === n);
    let rel;
    let body = '';
    let missing = [];
    if (x.report) {
      const params = x.params.map((p) => ({ name: p.name, value: str(values.params[p.name]).trim() })).filter((p) => p.value !== '')
        .concat(extraPairs(values.extra).map((kv) => ({ name: kv[0], value: kv[1] })));
      body = soapBody(x.reportPath, params);
      rel = x.path;
      if (!hasHeader('content-type')) headers['Content-Type'] = 'application/soap+xml;charset=UTF-8';
    } else {
      const u = urlOf(x, values);
      missing = u.missing;
      rel = u.path + u.query;
      Object.assign(headers, u.headers);
      if (x.body) {
        body = values.body;
        if (x.body.required && !body.trim()) missing.push('the body');
        if (body && !hasHeader('content-type')) headers['Content-Type'] = x.body.contentType;
        if (body.trim() && /json/i.test(x.body.contentType)) {
          try { JSON.parse(body); } catch (e) { return { ok: false, error: 'The body is not valid JSON: ' + e.message }; }
        }
      }
    }
    if (missing.length) return { ok: false, missing, error: 'Fill in ' + missing.join(', ') + ' first.' };
    const b = env.backend(x.backend);
    if (!b) return { ok: false, error: 'The backend "' + x.backend + '" is not in services/catalog.json.' };
    if (!x.reads && !q.confirm) {
      return { ok: false, needsConfirm: true, error: x.method + ' ' + x.path + ' changes data on ' + (b.url || x.backend) + ' — it is sent only when you confirm.' };
    }
    if (!hasHeader('accept')) headers.Accept = x.report ? '*/*' : 'application/json';
    const res = await env.send(x.backend, rel, { method: x.method, headers, body });
    const d = decode(res, x);
    const status = res.status || 0;
    const size = (res.body || Buffer.alloc(0)).length;
    const shape = d.json !== undefined && x.exampleValue !== null && x.exampleValue !== undefined ? Object.assign(compareShape(x.exampleValue, d.json), { basis: x.example }) : null;
    const ok = status > 0 && status < 400 && !d.fault;
    const entry = { at: now().toISOString(), status, ms: res.ms || 0, size, ok, method: x.method, url: rel.slice(0, 500), rows: d.table ? d.table.total : null, shape: shape ? shape.status : '' };
    state.history[x.key] = [entry].concat(state.history[x.key] || []).slice(0, HISTORY);
    state.values[x.key] = { params: values.params, extra: values.extra, body: values.body.slice(0, KEEP_BODY), at: entry.at };
    if (d.table) learn(d.table, x.report ? x.reportName : x.operation, x.report ? '' : x.path);
    save();
    const truncated = d.pretty.length > SHOW;
    return { ok, status, statusText: res.error ? 'no answer' : str(res.statusText || STATUS_CODES[status] || ''), ms: res.ms || 0, size, sizeText: sizeText(size),
      method: x.method, url: (b.url || '') + rel, contentType: d.contentType, error: res.error || d.error || '', fault: d.fault,
      headers: Object.keys(res.headers || {}).sort().map((k) => ({ k, v: str(res.headers[k]) })),
      pretty: truncated ? d.pretty.slice(0, SHOW) : d.pretty, truncated, table: d.table, report: d.report, shape,
      curl: curlOf({ method: x.method, url: (b.url || '') + rel, headers, body, user: b.user || '' }),
      history: state.history[x.key], sent: { headers, body: body.slice(0, 20000) } };
  }

  /** Every call of the page that only reads, with the values last used (the page's API health). The calls that need
   *  nothing run first; a value they answer fills a call that needs it (an id from a list → its detail). */
  async function check(list, env) {
    const eps = uniq((Array.isArray(list) ? list : []).map(str).filter(Boolean)).slice(0, CHECK_MAX);
    const results = {};
    const ready = [];
    const later = [];
    eps.forEach((e) => {
      const x = opOf(root, e);
      if (!x.ok) { results[e] = { endpoint: e, state: 'skip', note: x.error }; return; }
      if (x.report) { results[e] = { endpoint: e, state: 'skip', note: 'Runs the reports: run each one under BI Publisher reports.' }; return; }
      if (!x.reads) { results[e] = { endpoint: e, state: 'skip', note: 'Changes data: test it on its own.' }; return; }
      const saved = state.values[e] || {};
      const params = {};
      x.params.forEach((p) => { if (p.def) params[p.name] = p.def; });
      Object.assign(params, saved.params || {});
      const u = urlOf(x, { params, extra: saved.extra });
      (u.missing.length ? later : ready).push({ e, x, params, extra: saved.extra || '', missing: u.missing });
    });
    const runOne = async (c, note) => {
      const r = await run({ endpoint: c.e, params: c.params, extra: c.extra }, env);
      const differs = r.shape && r.shape.status === 'differs';
      results[c.e] = { endpoint: c.e, state: r.ok ? (differs ? 'warn' : 'ok') : 'fail', status: r.status, ms: r.ms, rows: r.table ? r.table.total : null,
        note: [note, r.ok ? (differs ? 'its answer differs from the example: ' + (r.shape.counts.missing ? r.shape.counts.missing + ' fields gone' : r.shape.counts.changed + ' types changed') : (r.table ? r.table.total + (r.table.total === 1 ? ' row' : ' rows') : '')) : (r.fault || r.error || r.statusText || 'failed')].filter(Boolean).join(' · ') };
    };
    const pool = async (items, fn) => { let i = 0; const w = async () => { while (i < items.length) { const k = i++; await fn(items[k]); } }; await Promise.all([w(), w(), w()]); };
    await pool(ready, (c) => runOne(c, ''));
    await pool(later, async (c) => {
      const s = suggest(c.x.params.filter((p) => c.missing.indexOf(p.name) !== -1), c.x);
      const filled = c.missing.filter((n) => s[n] && s[n].length);
      if (filled.length < c.missing.length) {
        results[c.e] = { endpoint: c.e, state: 'skip', note: 'Needs ' + c.missing.filter((n) => filled.indexOf(n) === -1).join(', ') + ': test it once with a value.' };
        return;
      }
      filled.forEach((n) => { c.params[n] = s[n][0].value; });
      await runOne(c, 'with ' + filled.map((n) => n + '=' + s[n][0].value + ' (from ' + s[n][0].from.split(' · ')[0] + ')').join(', '));
    });
    const out = eps.map((e) => results[e]);
    const n = (st) => out.filter((r) => r.state === st).length;
    return { ok: true, results: out, passed: n('ok'), warned: n('warn'), failed: n('fail'), skipped: n('skip') };
  }

  /** The last run of each call (the REST table shows it beside the call). */
  function last(keys) {
    const out = {};
    (Array.isArray(keys) ? keys : []).slice(0, 300).forEach((k) => { const h = state.history[str(k)]; if (h && h.length) out[k] = h[0]; });
    return { ok: true, last: out };
  }

  /** The page's reports: read from its files; one it names (XX_RP) but whose path is in shared code, found in its app. */
  function reports(files, names, app) {
    const list = reportsIn(files);
    const want = uniq((names || []).map(str).filter((n) => /^[A-Z][A-Z0-9_]+$/.test(n) && !list.some((r) => r.name === n)));
    if (want.length && app) {
      const more = reportsIn(appJs(root, app).filter((f) => { try { return want.some((n) => fs.readFileSync(f, 'utf8').indexOf(n + '.xdo') !== -1); } catch (e) { return false; } })
        .map((f) => ({ path: path.relative(root, f).split(path.sep).join('/'), text: fs.readFileSync(f, 'utf8') })));
      more.forEach((r) => { if (want.indexOf(r.name) !== -1 && !list.some((x) => x.name === r.name)) list.push(r); });
    }
    want.forEach((n) => { if (!list.some((r) => r.name === n)) list.push({ name: n, path: '/Custom/EquipRite/' + n + '.xdo', params: [], rowTag: '', file: '', guessed: true }); });
    return { ok: true, reports: list.sort((a, b) => (a.name < b.name ? -1 : 1)).map((r) => Object.assign(r, { key: 'report:' + r.path })) };
  }

  return { op, report, run, check, last, reports, flush, root };
}

module.exports = { open, opOf, urlOf, extraPairs, skeleton, soapBody, reportBytesOf, rowTagOf, xmlRows, rowsOf, shapeOf, compareShape, prettyXml, curlOf, decode, reportsIn, normKey, BIP };
