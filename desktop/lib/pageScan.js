'use strict';
/**
 * Reads the Visual Builder pages in the project (every app under webApps/) and works out each one's technical facts
 * straight from its files — what the Application pages screen shows and "Analyze with AI" reads:
 *
 *   features      the sections it shows (headings), the actions (buttons → the listener → the chains they run), the
 *                 fields people fill in, the Oracle JET / Redwood components it uses, what it is opened with (inputs)
 *   logic         each action chain (what its own comment says it does, the services it calls, the modules it uses,
 *                 the pages it opens) and each rules module (resources/js/*.js) with what its comment says
 *   integrations  every REST call: the endpoint (service/operation) → its HTTP method and path and summary (from
 *                 services/<service>/openapi3.json) → the backend it goes to (EquipRite REST, Fusion, OIC, BI Publisher,
 *                 Jira…); the BI Publisher reports it runs; the desktop app's local services it uses
 *   links         the other screens it opens
 *   codeHash      a hash of its files, so a sheet can say "the code changed since"
 *
 *   list(root)            [{ id, app, appName, flow, page, label, description, files }]  — every page, quickly
 *   analyze(root, id)     the facts of one page (above), or null
 *
 * Pure reading: nothing is written. An id is "<app>/<flow>/<page>" ("vbredwoodapp/main/workbench"); an app's root
 * pages (its shell) are "<app>//<page>".
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const APPS = {
  vbredwoodapp: 'Old EquipRite', equiprite: 'New EquipRite', 'equiprite-next': 'EquipRite Next',
  'equiprite-mobile': 'EquipRite Mobile', 'equiprite-future': 'EquipRite Future',
};
const BACKENDS = {
  eqpt: 'EquipRite REST (eqpt)', fusion: 'Oracle Fusion REST', ics: 'Oracle Integration Cloud (OIC)', bipService: 'Oracle BI Publisher (SOAP)',
  callPWPBIP: 'Oracle BI Publisher (PWP)', commonService: 'Rite Common Service', jira: 'Jira Cloud',
};
const LOCAL = {
  __ai: 'Saved AI analyses (on this PC)', __fdd: 'FDD library (git)', __pages: 'Application pages (git)', __minutes: 'Standup minutes (on this PC)',
  __followups: 'Follow-ups (on this PC)', __sql: 'SQL worksheet / Ask AI (on this PC)', __jira: 'Jira connection (on this PC)', __rec: 'Test evidence (on this PC)',
  __future: 'EquipRite Future store (on this PC)', __app: 'Phone app pairing', __services: 'Web services log',
};

const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } };
const exists = (f) => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } };
const isDir = (f) => { try { return fs.statSync(f).isDirectory(); } catch (e) { return false; } };
const uniq = (a) => a.filter((x, i) => x && a.indexOf(x) === i);
const rel = (root, f) => path.relative(root, f).split(path.sep).join('/');
const clean = (s) => String(s || '').replace(/\[\[[\s\S]*?\]\]/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const humanize = (id) => String(id || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** The first comment of a file: its header ("// …" lines or a block), as one paragraph. */
function headerComment(src, max) {
  const s = String(src || '');
  const lines = s.split('\n');
  const out = [];
  let started = false, inBlock = false;
  for (let i = 0; i < Math.min(lines.length, 120); i++) {
    const t = lines[i].trim();
    if (inBlock) {
      if (t.indexOf('*/') !== -1) { out.push(t.replace(/\*\/.*$/, '').replace(/^\*\s?/, '')); break; }
      out.push(t.replace(/^\*\s?/, ''));
      continue;
    }
    if (/^\/\*\*?/.test(t)) { started = true; inBlock = true; const rest = t.replace(/^\/\*\*?/, '').replace(/\*\/.*$/, ''); if (rest.trim()) out.push(rest); if (t.indexOf('*/') > 1) break; continue; }
    if (/^\/\//.test(t)) { started = true; out.push(t.replace(/^\/\/\s?/, '')); continue; }
    if (started && t === '') break;
    if (started) break;
  }
  const text = out.join(' ').replace(/\s+/g, ' ').replace(/^(Run|Rules|Pure)\b.*$/, '').trim();
  return max && text.length > max ? text.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : text;
}

/** Every page of every app: [{ id, app, appName, flow, page, json, html, js, chainsDir }]. */
function pagesOf(root) {
  const web = path.join(root, 'webApps');
  const out = [];
  const add = (app, flow, dir, file) => {
    const page = file.replace(/-page\.json$/, '');
    const base = path.join(dir, page + '-page');
    out.push({ id: app + '/' + flow + '/' + page, app: app, appName: APPS[app] || app, flow: flow, page: page,
      json: base + '.json', html: base + '.html', js: base + '.js', chainsDir: base + '-chains' });
  };
  (isDir(web) ? fs.readdirSync(web) : []).sort().forEach((app) => {
    const appDir = path.join(web, app);
    if (!isDir(appDir) || !exists(path.join(appDir, 'app-flow.json'))) return;
    const rootPages = path.join(appDir, 'pages');
    if (isDir(rootPages)) fs.readdirSync(rootPages).filter((f) => /-page\.json$/.test(f)).sort().forEach((f) => add(app, '', rootPages, f));
    const flows = path.join(appDir, 'flows');
    (isDir(flows) ? fs.readdirSync(flows) : []).sort().forEach((flow) => {
      const pd = path.join(flows, flow, 'pages');
      if (isDir(pd)) fs.readdirSync(pd).filter((f) => /-page\.json$/.test(f)).sort().forEach((f) => add(app, flow, pd, f));
    });
  });
  return out;
}

// EquipRite Next's menu (resources/js/nav.js): which screen a flow/page is, and how it is opened.
const navCache = {};
function nextNav(root) {
  const f = path.join(root, 'webApps', 'equiprite-next', 'resources', 'js', 'nav.js');
  const src = read(f);
  if (navCache.src === src) return navCache.value;
  let N = null;
  try {
    const sb = { console: { log() {}, warn() {} }, define: (deps, factory) => { N = factory({ isFeatureEnabled: () => true }); } };
    vm.createContext(sb);
    vm.runInContext(src, sb, { timeout: 2000 });
  } catch (e) { N = null; }
  const byRoute = {};
  if (N && N.GROUPS) N.GROUPS.forEach((g) => (g.items || []).forEach((it) => { if (it.route) byRoute[it.route.flow + '/' + it.route.page] = { navId: it.id, label: it.label, group: g.label || '' }; }));
  if (N && N.RECORDS) Object.keys(N.RECORDS).forEach((k) => { const r = N.RECORDS[k]; const key = r.flow + '/' + r.page; if (!byRoute[key]) byRoute[key] = { record: k, label: '', group: '' }; });
  navCache.src = src; navCache.value = byRoute;
  return byRoute;
}

/** A page's name, as people know it: its menu label, else its page title, its first heading, its description. */
function labelOf(root, p, html, json) {
  if (p.app === 'equiprite-next') { const n = nextNav(root)[p.flow + '/' + p.page]; if (n && n.label) return n.label; }
  const title = /page-title="([^"[]+)"/.exec(html) || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const t = title ? clean(title[1]) : '';
  if (t && t.length <= 80) return t;
  const d = String((json && json.description) || '').split(/[.:(—]/)[0].trim();
  if (d && d.length <= 60) return d;
  return humanize(p.page);
}

/** How the page is opened in its app (what a screenshot loads). */
function routeOf(root, p) {
  if (p.app === 'equiprite-next') {
    const n = nextNav(root)[p.flow + '/' + p.page];
    if (n && n.navId) return { url: '/?open=' + n.navId, menu: (n.group ? n.group + ' › ' : '') + n.label, needs: '' };
    if (n && n.record) return { url: '', menu: '', needs: 'Opened from another screen (record "' + n.record + '"): capture it there, or upload a screenshot.' };
    return { url: '', menu: '', needs: 'Not in the menu: upload a screenshot.' };
  }
  if (!p.flow) return { url: '/', menu: '', needs: '' };
  return { url: '/vp/shell/' + p.flow + '/' + p.page, menu: '', needs: '' };
}

/** The services: endpoint "service/operationId" → { method, path, summary, backend }. */
const svcCache = {};
function serviceOps(root) {
  const dir = path.join(root, 'services');
  const key = isDir(dir) ? fs.readdirSync(dir).join(',') : '';
  if (svcCache.key === key && svcCache.root === root) return svcCache.value;
  const ops = {};
  (isDir(dir) ? fs.readdirSync(dir) : []).forEach((svc) => {
    const f = path.join(dir, svc, 'openapi3.json');
    if (!exists(f)) return;
    let d;
    try { d = JSON.parse(read(f)); } catch (e) { return; }
    const srv = ((d.servers || [])[0] || {}).url || '';
    const backend = (/backends\/([^/]+)/.exec(srv) || [])[1] || '';
    Object.keys(d.paths || {}).forEach((p) => {
      Object.keys(d.paths[p]).forEach((m) => {
        const o = d.paths[p][m];
        if (o && o.operationId) ops[svc + '/' + o.operationId] = { method: m.toUpperCase(), path: p, summary: o.summary || '', backend: backend, backendLabel: BACKENDS[backend] || backend };
      });
    });
  });
  svcCache.key = key; svcCache.root = root; svcCache.value = ops;
  return ops;
}

/** What a piece of code does to the outside: endpoints, reports, local services, screens it opens, modules it uses. */
function scanCode(src) {
  const s = String(src || '');
  const all = (re, g) => { const out = []; let m; const r = new RegExp(re.source, 'g'); while ((m = r.exec(s))) out.push(m[g || 1]); return uniq(out); };
  return {
    endpoints: all(/endpoint['"]?\s*:\s*['"]([A-Za-z0-9_-]+\/[A-Za-z0-9_]+)['"]/),
    reports: uniq(all(/\b([A-Z][A-Z0-9_]{2,}_RP)\b/).concat(all(/\/Custom\/[^'"\s]+\/([A-Za-z0-9_]+)\.xdo/))),
    local: all(/['"`]\/(__[a-z]+)\//),
    opens: uniq(all(/record:\s*['"]([a-z0-9-]+)['"]/).map((r) => 'record ' + r).concat(all(/navId:\s*['"]([a-z0-9-]+)['"]/).map((n) => 'menu ' + n))
      .concat(all(/navigateToPage[\s\S]{0,80}?page:\s*['"]([A-Za-z0-9/_-]+)['"]/).map((x) => 'page ' + x))
      .concat(all(/navigateToFlow[\s\S]{0,80}?flow:\s*['"]([A-Za-z0-9/_-]+)['"]/).map((x) => 'flow ' + x))),
    modules: all(/['"](resources\/js\/[A-Za-z0-9_/-]+)['"]/),
  };
}

function list(root) {
  return pagesOf(root).map((p) => {
    const html = read(p.html);
    let json = {};
    try { json = JSON.parse(read(p.json)); } catch (e) { json = {}; }
    return { id: p.id, app: p.app, appName: p.appName, flow: p.flow, page: p.page, label: labelOf(root, p, html, json),
      description: String(json.description || '').slice(0, 400), route: routeOf(root, p) };
  });
}

function analyze(root, id) {
  const p = pagesOf(root).filter((x) => x.id === id)[0];
  if (!p) return null;
  const appDir = path.join(root, 'webApps', p.app);
  const htmlSrc = read(p.html), jsSrc = read(p.js), jsonSrc = read(p.json);
  let json = {};
  try { json = JSON.parse(jsonSrc); } catch (e) { json = {}; }
  const chainFiles = isDir(p.chainsDir) ? fs.readdirSync(p.chainsDir).filter((f) => /\.js$/.test(f)).sort() : [];
  const files = [p.json, p.html, p.js].filter(exists).concat(chainFiles.map((f) => path.join(p.chainsDir, f)));
  const hash = crypto.createHash('sha1');
  files.forEach((f) => hash.update(rel(root, f) + '\n' + read(f)));
  const ops = serviceOps(root);

  // ── features ──
  const sections = uniq(Array.from(htmlSrc.matchAll(/(?:page-title|header-text|drawer-title|dialog-title)="([^"[]+)"/g)).map((m) => clean(m[1]))
    .concat(Array.from(htmlSrc.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)).map((m) => clean(m[2])))
    .filter((t) => t && t.length <= 90)).slice(0, 40);
  // table and grid columns: Redwood tables declare them in the page JSON (headerText), the hand-made grids in HTML
  const columns = uniq(Array.from((jsonSrc + htmlSrc.replace(/&quot;/g, '"')).matchAll(/["']?headerText["']?\s*:\s*["']([^"']{1,60})["']/g)).map((m) => m[1])
    .concat(Array.from(htmlSrc.matchAll(/role="columnheader"[^>]*>([\s\S]*?)<\/span>/g)).map((m) => clean(m[1]))).filter(Boolean)).slice(0, 60);
  const listeners = json.eventListeners || {};
  const chainsOf = (name) => ((listeners[name] && listeners[name].chains) || []).map((c) => c.chain).filter(Boolean);
  const actions = [];
  Array.from(htmlSrc.matchAll(/<(button|oj-button|a|oj-c-button)\b([^>]*)>([\s\S]*?)<\/\1>/gi)).forEach((m) => {
    const attrs = m[2];
    const lis = (/on-(?:click|oj-action|ojAction)="\[\[\s*\$listeners\.(\w+)\s*\]\]"/.exec(attrs) || [])[1];
    if (!lis) return;
    // the text shown, else the words inside its binding ('✨ Re-run analysis'), else its title, else its id
    const lits = Array.from(String(m[3]).matchAll(/'([^'\]]{2,60})'/g)).map((x) => x[1].trim()).filter((x) => /[A-Za-z]/.test(x) && !/^[.#]|\$|===/.test(x));
    const label = clean(m[3]) || lits.sort((a, b) => b.length - a.length)[0] || clean((/(?:title|aria-label|label)="([^"[]+)"/.exec(attrs) || [])[1])
      || humanize(((/\bid="([^"[]+)"/.exec(attrs) || [])[1] || lis).replace(/^on/, ''));
    if (!actions.some((a) => a.label === label && a.listener === lis)) actions.push({ label: label.slice(0, 80), listener: lis, chains: chainsOf(lis) });
  });
  // everything else that reacts: a component's event (a row picked, a tab changed, a filter set) and its chains
  Array.from(htmlSrc.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*?)>/g)).forEach((m) => {
    const tag = m[1], attrs = m[2];
    if (/^(button|oj-button|a|oj-c-button)$/.test(tag)) return;
    Array.from(attrs.matchAll(/on-([a-z-]+)="\[\[\s*\$listeners\.(\w+)\s*\]\]"/g)).forEach((e) => {
      const what = clean((/(?:aria-label|label|title)="([^"[]+)"/.exec(attrs) || [])[1]);
      const label = (what ? what + ': ' : (tag.indexOf('oj-') === 0 ? tag + ': ' : '')) + e[1].replace(/-/g, ' ');
      if (!actions.some((a) => a.listener === e[2])) actions.push({ label: label.slice(0, 80), listener: e[2], chains: chainsOf(e[2]) });
    });
  });
  const LIFE = { vbBeforeEnter: 'before the page opens', vbEnter: 'when the page opens', vbExit: 'when it is left', vbAfterNavigate: 'after it navigates', vbNotification: 'on a notification' };
  const lifecycle = Object.keys(listeners).filter((l) => LIFE[l]).map((l) => ({ when: LIFE[l], chains: chainsOf(l) }));
  const fields = [];
  Array.from(htmlSrc.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/gi)).forEach((m) => { const t = clean(m[1]); if (t && t.length <= 60 && fields.indexOf(t) === -1) fields.push(t); });
  Array.from(htmlSrc.matchAll(/label-hint="([^"[]+)"/g)).forEach((m) => { const t = clean(m[1]); if (t && fields.indexOf(t) === -1) fields.push(t); });
  Array.from(htmlSrc.matchAll(/placeholder="([^"[]+)"/g)).forEach((m) => { const t = clean(m[1]); if (t && t.length <= 60 && fields.indexOf(t) === -1 && !/^filter$/i.test(t)) fields.push(t); });
  const components = uniq(Object.keys((json.imports && json.imports.components) || {}).concat(Array.from(htmlSrc.matchAll(/<(oj-[a-z0-9-]+)/g)).map((m) => m[1])))
    .filter((c) => !/^oj-bind-/.test(c)).sort();
  const vars = json.variables || {};
  const inputs = Object.keys(vars).filter((k) => vars[k] && vars[k].input).map((k) => ({ name: k, about: vars[k].description || '' }));

  // ── logic ──
  const pageCode = scanCode(jsSrc);
  const chains = chainFiles.map((f) => {
    const src = read(path.join(p.chainsDir, f));
    const code = scanCode(src);
    // the comment inside the define (after 'use strict'), or above the class
    const inner = src.replace(/^[\s\S]*?'use strict';/, '');
    const usedBy = Object.keys(listeners).filter((l) => chainsOf(l).indexOf(f.replace(/\.js$/, '')) !== -1);
    return { name: f.replace(/\.js$/, ''), file: rel(root, path.join(p.chainsDir, f)), about: headerComment(inner, 600) || headerComment(src, 600),
      calls: code.endpoints, reports: code.reports, local: code.local, opens: code.opens, modules: code.modules, on: usedBy, lines: src.split('\n').length };
  });
  // the modules the page and its chains use, and the ones those use (two levels): their services count too
  let moduleIds = uniq(pageCode.modules.concat(...chains.map((c) => c.modules)));
  for (let depth = 0; depth < 2; depth++) {
    const more = [];
    moduleIds.forEach((m) => scanCode(read(path.join(appDir, m + '.js'))).modules.forEach((x) => { if (moduleIds.indexOf(x) === -1 && more.indexOf(x) === -1) more.push(x); }));
    if (!more.length) break;
    moduleIds = moduleIds.concat(more);
  }
  const modules = moduleIds.map((m) => {
    const f = path.join(appDir, m + '.js');
    const src = read(f);
    const code = scanCode(src);
    return { name: m.replace(/^resources\/js\//, ''), file: exists(f) ? rel(root, f) : '', about: headerComment(src, 500), local: code.local, calls: code.endpoints, reports: code.reports, lines: src ? src.split('\n').length : 0 };
  });

  // ── integrations ──
  const endpoints = uniq(pageCode.endpoints.concat(...chains.map((c) => c.calls), ...modules.map((m) => m.calls)));
  const rest = endpoints.map((e) => {
    const o = ops[e] || {};
    const usedBy = chains.filter((c) => c.calls.indexOf(e) !== -1).map((c) => c.name).concat(modules.filter((m) => m.calls.indexOf(e) !== -1).map((m) => m.name));
    return { endpoint: e, service: e.split('/')[0], operation: e.split('/')[1], method: o.method || '', path: o.path || '', summary: o.summary || '',
      backend: o.backend || '', backendLabel: o.backendLabel || (o.backend ? o.backend : 'not in services/ (check the name)'), usedBy: uniq(usedBy) };
  });
  const reports = uniq(pageCode.reports.concat(...chains.map((c) => c.reports), ...modules.map((m) => m.reports))).sort();
  const local = uniq(pageCode.local.concat(...chains.map((c) => c.local), ...modules.map((m) => m.local))).map((l) => ({ route: '/' + l + '/', what: LOCAL[l] || l }));
  const backends = uniq(rest.map((r) => r.backendLabel).concat(reports.length ? ['Oracle BI Publisher (SOAP)'] : []));

  return {
    id: p.id, app: p.app, appName: p.appName, flow: p.flow, page: p.page,
    label: labelOf(root, p, htmlSrc, json), description: String(json.description || ''), route: routeOf(root, p),
    files: files.map((f) => ({ path: rel(root, f), lines: read(f).split('\n').length })), codeHash: hash.digest('hex').slice(0, 16),
    features: { sections: sections, actions: actions.slice(0, 80), fields: fields.slice(0, 80), columns: columns, components: components, inputs: inputs, lifecycle: lifecycle },
    logic: { chains: chains, modules: modules, variables: Object.keys(vars).length },
    integrations: { rest: rest, reports: reports, local: local, backends: backends },
    links: uniq(pageCode.opens.concat(...chains.map((c) => c.opens))),
  };
}

module.exports = { list, analyze, pagesOf, headerComment, scanCode, serviceOps, APPS, BACKENDS };
