'use strict';
/**
 * Visual Builder Studio, for Build.Rite (Setup → Organizations & projects): the organizations the team works in and their
 * projects — the first level of Build.Rite's own structure (organization → project → application → baseline / working /
 * workspaces → releases), connected to Oracle's.
 *
 *   An organization: its VB Studio address (https://<host>/<org>/, the organization's page), a name, and the sign-in
 *   (username and password, the password encrypted by the OS keychain in this app's data folder — when the keychain
 *   cannot encrypt, kept for this run only; never sent back to the page).
 *
 *   A project: added by its Git repository's address (the project's Repositories tab:
 *   https://<host>/<org>/s/<org>_<project>/scm/<repo>.git) — VB Studio has no documented API to list projects, and its
 *   project id is read from that address. Checked: its branches (git ls-remote: the workspaces' pushed branches too) and
 *   its build jobs (VB Studio's documented builds API, https://<host>/<org>/rest/<org>_<project>/cibuild/v1/jobs).
 *   The sign-in goes to git as a header in its environment (never in the address, the command line or a file).
 *
 *   open({ file, encrypt, decrypt, fetch, sessionFetch, gitPath, now }) → store
 *     state()                                  { orgs: [...], projects: [...] } — never a password
 *     saveOrg({ id, name, url, user, password }) an empty password keeps the saved one
 *     removeOrg(id)   addProject({ orgId, repoUrl, name })   checkProject(id)   removeProject(id)
 *     auth(orgId)                              { host, org, user, header } for Build.Rite's own calls, or null
 *     sync({ orgId })                          Sync from VB Studio (API, no window): the calls VB Studio's pages make,
 *                                              made directly (Basic; else the window's session) — projects (every page),
 *                                              their repositories and workspaces
 *     windowSignIn(host, header)               the window's own sign-in, for Sync this run only (memory)
 *     learn(found)  discovered()  clearDiscovered()  diagnostic()  setFinder(open, url)
 *                                              Find in VB Studio: organizations, projects (their Git addresses) and
 *                                              workspaces read from VB Studio's own pages in a window of Build.Rite
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const str = (v) => (v === undefined || v === null ? '' : String(v));
const idOf = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || crypto.randomBytes(4).toString('hex');

/** The organization's page → { url, host, org } ('' org when the address has no organization in it). */
function parseOrgUrl(v) {
  let s = str(v).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  const org = (u.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(org)) return { url: 'https://' + u.hostname.toLowerCase() + '/', host: u.hostname.toLowerCase(), org: '' };
  return { url: 'https://' + u.hostname.toLowerCase() + '/' + org + '/', host: u.hostname.toLowerCase(), org: org };
}

/** A project's Git address → { repoUrl, host, org, project, repo } (the sign-in in it, if any, left out). */
function parseRepoUrl(v) {
  let s = str(v).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  const parts = u.pathname.split('/').filter(Boolean);
  // /<org>/s/<org>_<project>/scm/<repo>.git
  const si = parts.indexOf('s');
  const ci = parts.indexOf('scm');
  if (si < 1 || ci !== si + 2 || !parts[ci + 1]) return null;
  const org = parts[0].toLowerCase();
  const full = parts[si + 1];
  if (full.toLowerCase().indexOf(org + '_') !== 0) return null;
  const project = full.slice(org.length + 1);
  const repo = parts[ci + 1].replace(/\.git$/i, '');
  if (!project || !repo) return null;
  return { repoUrl: 'https://' + u.hostname.toLowerCase() + '/' + parts[0] + '/s/' + full + '/scm/' + repo + '.git', host: u.hostname.toLowerCase(), org: org, project: project, repo: repo };
}

/** Git's branches from `git ls-remote --heads --symref`: { branches: [...], head }. */
function branchesOf(out) {
  const branches = [];
  let head = '';
  str(out).split('\n').forEach((l) => {
    const sym = /^ref:\s+refs\/heads\/(\S+)\s+HEAD/.exec(l);
    if (sym) { head = sym[1]; return; }
    const m = /^[0-9a-f]{7,64}\s+refs\/heads\/(\S+)$/.exec(l.trim());
    if (m) branches.push(m[1]);
  });
  return { branches: branches.filter((b, i, a) => a.indexOf(b) === i).sort(), head: head };
}

/** VB Studio's builds API answer → the jobs' names. */
function jobsOf(body) {
  const l = Array.isArray(body) ? body : body && (body.items || body.jobs || body.data || []);
  return (Array.isArray(l) ? l : []).map((j) => str(typeof j === 'string' ? j : j && (j.name || j.jobName || j.id))).filter(Boolean);
}

/** What went wrong reaching VB Studio, in words (git's or the API's). */
function why(text, status) {
  const t = str(text);
  if (status === 401 || /\b401\b|Authentication failed|could not read Username|invalid credentials|not authorized/i.test(t)) return 'The username or password was refused by VB Studio.';
  if (status === 403 || /\b403\b/.test(t)) return 'Signed in, but this user may not open this project in VB Studio.';
  if (status === 404 || /\b404\b|not found|does not exist/i.test(t)) return 'VB Studio says there is no such repository (check the address from the project\'s Repositories tab).';
  if (/Could not resolve host|ENOTFOUND|getaddrinfo/i.test(t)) return 'Could not reach VB Studio from this PC (check the address and the network).';
  if (/timed out|ETIMEDOUT|timeout/i.test(t)) return 'VB Studio did not answer in time.';
  return t.trim().split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 300) || 'It did not work.';
}

/** How a call was signed in, in words. */
const WAYS = { basic: 'username and password', page: 'your VB Studio session, inside VB Studio\'s own page', session: 'the VB Studio window\'s session', window: 'the VB Studio window\'s sign-in' };
/**
 * VB Studio's own calls Build.Rite knows without being shown (seen in VB Studio's pages: its organization page lists the
 * organization's projects with this one). The ones learned from VB Studio's pages come first.
 */
const BUILT_IN = [
  { path: '/<org>/api2/v2/organization/projects', role: 'projects', query: '', builtIn: true },
];

function open(opts) {
  const o = opts || {};
  const file = o.file || '';
  const now = o.now || (() => new Date());
  const encrypt = o.encrypt || null;
  const decrypt = o.decrypt || null;
  const fetchFn = o.fetch || (typeof fetch === 'function' ? fetch : null);
  const mem = {}; // passwords for this run only, when the keychain cannot encrypt
  let data = { orgs: [], projects: [] };
  try { if (file) data = Object.assign(data, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { /* first run */ }
  const save = () => { if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 1), { mode: 0o600 }); };
  const orgOf = (id) => data.orgs.filter((x) => x.id === str(id))[0] || null;
  const projOf = (id) => data.projects.filter((x) => x.id === str(id))[0] || null;
  const password = (org) => {
    if (!org) return '';
    if (mem[org.id]) return mem[org.id];
    if (!org.password || !decrypt) return '';
    try { return decrypt(Buffer.from(org.password, 'base64')); } catch (e) { return ''; }
  };
  const header = (org) => { const p = password(org); return org && org.user && p ? 'Basic ' + Buffer.from(org.user + ':' + p, 'utf8').toString('base64') : ''; };
  const viewOrg = (x) => ({ id: x.id, name: x.name, url: x.url, host: x.host, org: x.org, user: x.user, hasPassword: !!password(x), keychain: !!encrypt, addedAt: x.addedAt, checked: x.checked || null,
    projects: data.projects.filter((p) => p.orgId === x.id).length });
  const state = () => ({ ok: true, orgs: data.orgs.map(viewOrg), projects: data.projects.map((p) => Object.assign({}, p)) });

  /** git, its sign-in in its environment for that host only (a header): never in the address, the command line or a file. */
  function git(args, org, ms) {
    return new Promise((resolve) => {
      if (typeof o.git === 'function') { Promise.resolve(o.git(args, org ? { host: org.host, header: header(org) } : null)).then(resolve, (e) => resolve({ code: 1, stdout: '', stderr: str(e && e.message) })); return; }
      const env = Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' });
      const h = header(org);
      if (h) { env.GIT_CONFIG_COUNT = '1'; env.GIT_CONFIG_KEY_0 = 'http.https://' + org.host + '/.extraHeader'; env.GIT_CONFIG_VALUE_0 = 'Authorization: ' + h; }
      require('child_process').execFile(o.gitPath || 'git', ['-c', 'credential.helper=', '-c', 'core.askPass='].concat(args), { env: env, windowsHide: true, timeout: ms || 60000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: str(stdout), stderr: str(stderr) + (err && err.killed ? ' timed out' : '') }));
    });
  }

  function saveOrg(b) {
    b = b || {};
    const u = parseOrgUrl(b.url);
    if (!u) throw new Error('That is not a VB Studio address: paste the organization\'s page, like https://<host>/<organization>/');
    if (!u.org) throw new Error('The address has no organization in it: paste the organization\'s page, like https://' + u.host + '/<organization>/');
    const user = str(b.user).trim();
    if (!user) throw new Error('Enter the username you sign in to VB Studio with.');
    let x = b.id ? orgOf(b.id) : data.orgs.filter((y) => y.url === u.url)[0] || null;
    const isNew = !x;
    if (!x) { x = { id: idOf(u.org), addedAt: now().toISOString() }; while (orgOf(x.id)) x.id = idOf(u.org) + '-' + crypto.randomBytes(2).toString('hex'); data.orgs.push(x); }
    x.name = str(b.name).trim().slice(0, 80) || x.name || u.org;
    x.url = u.url; x.host = u.host; x.org = u.org; x.user = user;
    const p = str(b.password);
    if (p) { if (encrypt) { x.password = encrypt(p).toString('base64'); delete mem[x.id]; } else { x.password = ''; mem[x.id] = p; } }
    if (isNew && !p) { data.orgs = data.orgs.filter((y) => y !== x); throw new Error('Enter the password (it is kept encrypted on this PC).'); }
    x.updatedAt = now().toISOString();
    save();
    return Object.assign({ ok: true }, { org: viewOrg(x) }, state());
  }
  function removeOrg(id) {
    const x = orgOf(id);
    if (!x) return { ok: false, error: 'No such organization.' };
    data.orgs = data.orgs.filter((y) => y !== x);
    data.projects = data.projects.filter((p) => p.orgId !== x.id);
    delete mem[x.id];
    save();
    return state();
  }

  /** Its branches (git) and build jobs (VB Studio's builds API): { ok, branches, head, jobs, jobsError } or { ok: false, error }. */
  async function probe(org, p) {
    const ls = await git(['ls-remote', '--symref', p.repoUrl], org, 60000);
    if (ls.code !== 0) return { ok: false, error: why(ls.stderr) };
    const b = branchesOf(ls.stdout);
    let jobs = [], jobsError = '';
    if (fetchFn) {
      try {
        const r = await fetchFn('https://' + org.host + '/' + org.org + '/rest/' + org.org + '_' + p.project + '/cibuild/v1/jobs', { headers: { Authorization: header(org), Accept: 'application/json' } });
        if (r.ok) { try { jobs = jobsOf(JSON.parse(await r.text())); } catch (e) { jobs = []; } } else jobsError = why('', r.status);
      } catch (e) { jobsError = why(e && e.message); }
    }
    return { ok: true, branches: b.branches, head: b.head || (b.branches.indexOf('main') !== -1 ? 'main' : b.branches.indexOf('master') !== -1 ? 'master' : b.branches[0] || ''), jobs: jobs, jobsError: jobsError };
  }
  async function addProject(b) {
    b = b || {};
    const org = orgOf(b.orgId);
    if (!org) return { ok: false, error: 'Choose its organization first.' };
    if (!header(org)) return { ok: false, error: 'The organization has no password saved on this PC: enter it again.' };
    const r = parseRepoUrl(b.repoUrl);
    if (!r) return { ok: false, error: 'That is not a VB Studio Git address: copy it from the project\'s Repositories tab, like https://' + org.host + '/' + org.org + '/s/' + org.org + '_<project>/scm/<repo>.git' };
    if (r.host !== org.host || r.org !== org.org) return { ok: false, error: 'That repository is in another organization (' + r.org + ' on ' + r.host + '), not ' + org.name + '.' };
    if (data.projects.some((p) => p.repoUrl === r.repoUrl)) return { ok: false, error: 'That repository is added already.' };
    const p = { id: idOf(r.project + '-' + r.repo), orgId: org.id, name: str(b.name).trim().slice(0, 80) || r.project, project: r.project, repo: r.repo, repoUrl: r.repoUrl, addedAt: now().toISOString() };
    while (projOf(p.id)) p.id = idOf(r.project + '-' + r.repo) + '-' + crypto.randomBytes(2).toString('hex');
    const pr = await probe(org, p);
    org.checked = { at: now().toISOString(), ok: pr.ok, message: pr.ok ? 'signed in' : pr.error };
    if (!pr.ok) { save(); return { ok: false, error: pr.error, state: state() }; }
    Object.assign(p, { branches: pr.branches, head: pr.head, jobs: pr.jobs, jobsError: pr.jobsError, checkedAt: now().toISOString() });
    data.projects.push(p);
    save();
    return Object.assign({ ok: true, project: p }, state());
  }
  async function checkProject(id) {
    const p = projOf(id);
    if (!p) return { ok: false, error: 'No such project.' };
    const org = orgOf(p.orgId);
    if (!org || !header(org)) return { ok: false, error: 'The organization has no password saved on this PC: enter it again.' };
    const pr = await probe(org, p);
    org.checked = { at: now().toISOString(), ok: pr.ok, message: pr.ok ? 'signed in' : pr.error };
    if (pr.ok) Object.assign(p, { branches: pr.branches, head: pr.head, jobs: pr.jobs, jobsError: pr.jobsError, checkedAt: now().toISOString(), error: '' });
    else p.error = pr.error;
    save();
    return pr.ok ? Object.assign({ ok: true, project: p }, state()) : Object.assign({ ok: false, error: pr.error }, { state: state() });
  }
  function removeProject(id) {
    const p = projOf(id);
    if (!p) return { ok: false, error: 'No such project.' };
    data.projects = data.projects.filter((x) => x !== p);
    save();
    return state();
  }
  function auth(orgId) { const org = orgOf(orgId); const h = header(org); return h ? { host: org.host, org: org.org, user: org.user, header: h } : null; }

  // ── Find in VB Studio: what VB Studio's own pages loaded (desktop/lib/vbsLearn.js), kept and merged across visits ──
  const L = require('./vbsLearn');
  let finder = { open: false, url: '', at: '', log: [] };
  function learn(found) {
    data.discovered = Object.assign(L.merge(data.discovered || {}, found || {}), { at: now().toISOString() });
    save();
    return discovered();
  }
  /** What was found: each organization (set up here or not), project (its repositories; added here or not), workspace. */
  function discovered() {
    const d = data.discovered || { orgs: [], projects: [], workspaces: [], calls: [] };
    const orgIdOf = (host, o) => (data.orgs.filter((x) => x.host === host && x.org === o)[0] || {}).id || '';
    const added = (url) => data.projects.some((p) => p.repoUrl === url);
    const roles = {};
    (d.calls || []).forEach((c) => { const r = c.role || L.roleOfPath(c.path); if (r && !/\{n\}|\{id\}/.test(c.path)) roles[r + (c.path.indexOf('<org>_<project>') !== -1 ? ':project' : '')] = true; });
    return { ok: true, at: d.at || '', finder: finder, sync: data.lastSync || null, syncing: !!syncing, syncLive: syncing && live ? live.slice() : null,
      learned: { projects: !!roles.projects, repos: !!roles['repos:project'], workspaces: !!(roles['workspaces:project'] || roles.workspaces) },
      orgs: (d.orgs || []).filter((o) => L.isOrgId(o.org)).map((o) => Object.assign({}, o, { orgId: orgIdOf(o.host, o.org) })),
      projects: (d.projects || []).map((p) => Object.assign({}, p, { orgId: orgIdOf(p.host, p.org), repos: (p.repos || []).map((r) => Object.assign({}, r, { added: added(r.url) })) })),
      workspaces: (d.workspaces || []).slice(), calls: (d.calls || []).length };
  }
  function clearDiscovered() { data.discovered = null; save(); return discovered(); }
  /** "Copy what Build.Rite saw": the calls VB Studio's pages made, as paths and field names only (no value), and counts. */
  function diagnostic() {
    const d = data.discovered || {};
    // the organizations' names and ids, and the projects' ids, never in it
    const ids = data.orgs.map((x) => x.name).concat(data.orgs.map((x) => x.org), (d.orgs || []).map((x) => x.org)).filter((x) => x && x.length > 2).sort((a, b) => b.length - a.length);
    const hideIds = (t) => ids.reduce((acc, id) => acc.split(id).join('<org>'), str(t));
    return JSON.stringify({ seen: d.at || '', organizations: (d.orgs || []).length, projects: (d.projects || []).length, repositories: (d.projects || []).reduce((n, p) => n + (p.repos || []).length, 0),
      workspaces: (d.workspaces || []).length, calls: (d.calls || []).map((c) => ({ path: c.path, role: c.role || L.roleOfPath(c.path), query: c.query || '', auth: c.auth || '', status: c.status, shape: c.shape })),
      lastSync: data.lastSync ? { at: data.lastSync.at, ok: data.lastSync.ok, counts: data.lastSync.counts, via: data.lastSync.via, steps: (data.lastSync.steps || []).map((x) => hideIds(x.text)) } : null }, null, 1);
  }
  /** The VB Studio window: open or not, its address, and its log (the last 200 lines; addresses without their query). */
  function setFinder(open, url, fresh) { finder = { open: !!open, url: str(url), at: now().toISOString(), log: fresh ? [] : (finder.log || []) }; }
  function finderLog(text) { finder.log = (finder.log || []).concat([{ at: now().toISOString(), text: str(text).slice(0, 400) }]).slice(-200); }

  // ── Sync from VB Studio (API): no window. VB Studio's documented API lists no organizations, projects or workspaces, so
  //    Build.Rite makes the calls VB Studio's own pages make — learned once, as paths with their ids hidden, when VB Studio
  //    was opened in Build.Rite's window (Find) — directly: each organization's project list (every page of it), then each
  //    project's repositories and workspaces. Signed in with the saved username and password (Basic, as VB Studio's REST
  //    API takes); when VB Studio refuses that for a call, with the VB Studio window's session (its cookies, kept by the
  //    desktop app between runs), else with the sign-in VB Studio's own pages sent this run (in memory only: never saved,
  //    logged or shown). Read only (GET). Every answer goes through the same reading as Find (lib/vbsLearn.js). ──
  const sessionFetch = o.sessionFetch || null;
  // VB Studio's own page (desktop/main.js: a hidden VB Studio window, signed in with the session kept from Open VB Studio):
  // the call made from inside it, as its own pages make it — what VB Studio's internal calls (api2) take
  const pageFetch = o.pageFetch || null;
  const tokens = {}; // host → the window's own sign-in for this run (memory only)
  const viaOf = {}; // host and call → the way in that worked last (tried first next time)
  const viaHost = {}; // host → the way in that worked last for any call (tried next)
  let pageOff = {}; // host → VB Studio's page needs a sign-in (this sync: not tried again)
  /** The VB Studio window's pages sent a sign-in of their own (a bearer token) to this host: usable by Sync for this run only. */
  function windowSignIn(host, value) { const h = str(host).toLowerCase(); if (L.isVbsHost(h) && /^Bearer\s+\S+$/i.test(str(value))) tokens[h] = str(value); }
  const timeout = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(o.syncTimeoutMs || 30000) : undefined);
  /** One GET, by each way in until one answers JSON: { ok, status, json, via } or { ok: false, status, error }. */
  async function getJson(url, host, basic, key) {
    const k = host + ' ' + str(key);
    const ways = [];
    if (basic && fetchFn) ways.push(['basic', () => fetchFn(url, { headers: { Authorization: basic, Accept: 'application/json' }, signal: timeout() })]);
    if (pageFetch && !pageOff[host]) ways.push(['page', () => pageFetch(url, { headers: { Accept: 'application/json' } })]);
    if (sessionFetch) ways.push(['session', () => sessionFetch(url, { headers: { Accept: 'application/json' }, credentials: 'include', signal: timeout() })]);
    if (tokens[host] && fetchFn) ways.push(['window', () => fetchFn(url, { headers: { Authorization: tokens[host], Accept: 'application/json' }, signal: timeout() })]);
    if (!ways.length) return { ok: false, status: 0, error: 'No way to sign in: save the organization\'s password, or open VB Studio once and sign in there.' };
    const rank = (w) => (w[0] === viaOf[k] ? 2 : w[0] === viaHost[host] ? 1 : 0);
    ways.sort((a, b) => rank(b) - rank(a));
    let last = { status: 0, error: 'It did not work.' };
    for (let i = 0; i < ways.length; i++) {
      try {
        const r = await ways[i][1]();
        if (r && r.signIn) { pageOff[host] = true; last = { status: 401, signIn: true, error: 'VB Studio needs you to sign in again: Open VB Studio, sign in, close the window — then Sync.' }; continue; }
        const text = await r.text();
        let json = null;
        if (r.ok) { try { json = JSON.parse(text); } catch (e) { json = null; } }
        if (json !== null) { viaOf[k] = ways[i][0]; viaHost[host] = ways[i][0]; return { ok: true, status: r.status, json: json, via: ways[i][0] }; }
        if (last.signIn) continue; // keep the reason that says what to do
        last = { status: r.status, page: !!r.ok, error: r.ok ? 'VB Studio sent its sign-in page, not data' : r.status === 404 ? 'not there (this organization may not have it, or this user may not see it)' : why('', r.status) };
        if (r.status === 404) break; // not there, whoever asks
      } catch (e) { last = { status: 0, error: why(e && (e.name === 'TimeoutError' ? 'timed out' : e.message)) }; }
    }
    return { ok: false, status: last.status, error: last.error, signIn: !!last.signIn, page: !!last.page };
  }
  const pl = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : /^\d+$/.test(str(v)) ? Number(v) : 0);
  /** Every page of a list (Oracle's REST paging: hasMore / totalResults / a "next" link; offset & limit, or page): each answer to see(). */
  async function allPages(url0, host, basic, see, key) {
    let url = url0, pages = 0, got = 0, prevFirst = null, first = null;
    for (;;) {
      const r = await getJson(url, host, basic, key);
      if (!r.ok) return pages ? { ok: true, pages: pages, items: got, via: first && first.via, partial: r.error } : r;
      if (!first) first = r;
      see(url, r);
      pages++;
      const list = L.listsIn(r.json).sort((a, b) => b.length - a.length)[0] || [];
      const head = list.length ? JSON.stringify(list[0]).slice(0, 300) : '';
      if (!list.length || head === prevFirst || pages >= (o.syncMaxPages || 40)) break; // empty, or the paging was ignored
      prevFirst = head;
      got += list.length;
      const j = r.json && !Array.isArray(r.json) ? r.json : {};
      const total = num(j.totalResults) || num(j.total) || num(j.totalCount) || num(j.totalItems) || num(j.totalSize);
      const next = (Array.isArray(j.links) ? j.links : []).filter((l) => l && /^next$/i.test(str(l.rel)) && l.href)[0];
      if (!(j.hasMore === true || (total && got < total) || next)) break;
      const u = new URL(url);
      if (next) { try { const n = new URL(next.href, url); if (n.hostname !== u.hostname) break; url = n.toString(); continue; } catch (e) { break; } }
      if (u.searchParams.has('page') && !u.searchParams.has('offset')) u.searchParams.set('page', String((num(u.searchParams.get('page')) || 0) + 1));
      else if (u.searchParams.has('start') && !u.searchParams.has('offset')) u.searchParams.set('start', String(got));
      else { u.searchParams.set('offset', String(got)); if (!u.searchParams.has('limit')) u.searchParams.set('limit', String(list.length)); }
      url = u.toString();
    }
    return { ok: true, pages: pages, items: got, via: first && first.via };
  }
  /** A learned call's address for an organization (and a project): its ids put back. */
  const urlOf = (org, c, project) => 'https://' + org.host + str(c.path).replace(/<org>_<project>/g, org.org + '_' + project).replace(/<org>/g, org.org) + (c.query ? '?' + c.query : '');
  let syncing = null;
  let live = null; // the steps of the sync running, read by discovered() while it runs
  /**
   * Sync from VB Studio: { orgId } one organization, or every one set up here and each found on the same VB Studio (the
   * host of one set up: its sign-in borrowed); { orgKey: '<host>/<org>' } one of those; { orgKey, project } one project
   * only (its repositories and workspaces). → { ok, counts, via, steps, needLearn, sync } and what is found (as discovered()).
   */
  function sync(b) {
    if (syncing) return syncing;
    syncing = doSync(b || {}).finally(() => { syncing = null; });
    return syncing;
  }
  async function doSync(b) {
    const t0 = Date.now();
    const steps = [];
    live = steps;
    const step = (text) => { steps.push({ at: now().toISOString(), text: str(text).slice(0, 300) }); if (o.onSyncStep) { try { o.onSyncStep(str(text)); } catch (e) { /* only a log */ } } };
    const d = data.discovered || {};
    pageOff = {};
    const known = (d.calls || []).map((c) => Object.assign({}, c, { role: c.role || L.roleOfPath(c.path) }))
      .filter((c) => c.role && !/\{n\}|\{id\}/.test(c.path) && (c.path.indexOf('<org>_<project>') !== -1 || !c.shape || /\[\d+\]/.test(c.shape)));
    const calls = known.concat(BUILT_IN.filter((c) => !known.some((x) => x.path === c.path)));
    const pick = (role, inProject) => calls.filter((c) => c.role === role && (c.path.indexOf('<org>_<project>') !== -1) === inProject);
    const projCalls = pick('projects', false), orgCalls = pick('orgs', false);
    const perOrg = pick('workspaces', false);
    const perProject = pick('repos', true).concat(pick('workspaces', true));
    // the organizations: one, or each set up here and each found on the host of one set up (its sign-in borrowed)
    const saved = b.orgId ? data.orgs.filter((x) => x.id === str(b.orgId)) : data.orgs.slice();
    if (b.orgId && !saved.length) return { ok: false, error: 'No such organization.' };
    if (!saved.length && !(d.orgs || []).length) return { ok: false, error: 'Add your VB Studio organization first (its address and sign-in).' };
    const targets = saved.map((x) => ({ host: x.host, org: x.org, name: x.name, basic: header(x) }));
    if (!b.orgId) (d.orgs || []).filter((x) => L.isOrgId(x.org)).forEach((x) => { if (targets.some((y) => y.host === x.host && y.org === x.org)) return; const same = data.orgs.filter((y) => y.host === x.host)[0]; if (same) targets.push({ host: x.host, org: x.org, name: x.org, basic: same ? header(same) : '', borrowed: !!same }); });
    // one organization (by its host and id), one project of it
    const only = str(b.orgKey).toLowerCase();
    if (only) { const kept = targets.filter((x) => x.host + '/' + x.org === only); targets.length = 0; kept.forEach((x) => targets.push(x)); }
    if (only && !targets.length) return { ok: false, error: 'Set up that organization first (its sign-in), or one on the same VB Studio.' };
    const oneProject = str(b.project);
    if (oneProject && !perProject.length) {
      return { ok: false, needLearn: 'repos', error: 'Build.Rite has not seen how VB Studio lists a project\'s repositories and workspaces yet: Open VB Studio, open any project\'s Repositories and Workspaces pages, close the window — then this works for every project.' };
    }
    const l = L.learner();
    const via = {};
    const see = (url, r) => { via[r.via] = (via[r.via] || 0) + 1; l.see({ url: url, status: r.status, json: r.json, auth: r.via === 'window' ? 'bearer' : r.via }); };
    let needLearn = '';
    if (!projCalls.length && !oneProject) needLearn = 'projects';
    step('Sync from VB Studio (API): ' + targets.length + ' organization' + (targets.length === 1 ? '' : 's') + '; the calls learned from VB Studio\'s pages: ' + projCalls.length + ' project list, ' + perProject.length + ' per project, ' + (perOrg.length + orgCalls.length) + ' other');
    if (needLearn) step('Build.Rite has not seen VB Studio\'s project list yet: open VB Studio once (Find in VB Studio), go to the organization\'s page, close the window — then Sync makes that same call directly.');
    let refused = 0, signIn = false, pageOnly = false;
    for (let i = 0; i < targets.length; i++) {
      const org = targets[i];
      if (!org.basic && !sessionFetch && !tokens[org.host]) { step(org.name + ': no sign-in saved on this PC — skipped'); continue; }
      for (const c of oneProject ? perOrg : orgCalls.concat(projCalls, perOrg)) {
        const r = await allPages(urlOf(org, c), org.host, org.basic, see, c.path);
        if (r.ok) step(org.name + ': ' + c.path + ' — ' + c.role + ': ' + r.pages + ' page' + (r.pages === 1 ? '' : 's') + ', ' + r.items + ' item' + (r.items === 1 ? '' : 's') + ' (signed in by ' + WAYS[r.via] + ')' + (r.partial ? '; then: ' + r.partial : ''));
        else { refused++; if (r.signIn) signIn = true; if (r.page) pageOnly = true; step(org.name + ': ' + c.path + ' — ' + (r.status ? 'HTTP ' + r.status + ': ' : '') + r.error); }
      }
      if (!perProject.length) continue;
      // each project of this organization: found now, found before, or added here
      const ids = {};
      l.found().projects.concat(d.projects || []).forEach((p) => { if (p.host === org.host && p.org === org.org) ids[p.project] = true; });
      data.projects.forEach((p) => { const so = orgOf(p.orgId); if (so && so.host === org.host && so.org === org.org) ids[p.project] = true; });
      const list = oneProject ? [oneProject] : Object.keys(ids);
      if (!list.length) { step(org.name + ': no project known in it, so no repositories or workspaces asked'); continue; }
      for (const c of perProject) {
        let ok = 0, bad = 0, lastErr = '';
        // the first project alone (the way in that works found once), then six at a time
        for (let k = 0; k < list.length; k += (k === 0 ? 1 : 6)) {
          const rs = await Promise.all(list.slice(k, k === 0 ? 1 : k + 6).map((pid) => allPages(urlOf(org, c, pid), org.host, org.basic, see, c.path)));
          rs.forEach((r) => { if (r.ok) ok++; else { bad++; if (r.signIn) signIn = true; lastErr = (r.status ? 'HTTP ' + r.status + ': ' : '') + r.error; } });
        }
        step(org.name + ': ' + c.path + ' — ' + c.role + ' of ' + list.length + ' project' + (list.length === 1 ? '' : 's') + ': ' + ok + ' answered' + (bad ? ', ' + bad + ' not (' + lastErr + ')' : ''));
        if (bad && !ok) refused++;
      }
    }
    const f = l.found();
    const counts = { orgs: f.orgs.length, projects: f.projects.length, repos: f.projects.reduce((n, p) => n + p.repos.length, 0), workspaces: f.workspaces.length };
    learn(Object.assign(f, { calls: l.calls() }));
    const answered = Object.keys(via).reduce((n, k) => n + via[k], 0);
    step('Done in ' + Math.round((Date.now() - t0) / 100) / 10 + ' s: ' + pl(answered, 'answer') + ' read — ' + pl(counts.orgs, 'organization') + ' · ' + pl(counts.projects, 'project') + ' · ' + pl(counts.repos, 'repository', 'repositories') + ' · ' + pl(counts.workspaces, 'workspace'));
    if (!oneProject) data.lastSync = { at: now().toISOString(), ok: answered > 0, counts: counts, via: via, needLearn: needLearn, signIn: signIn, steps: steps };
    save();
    const ok = answered > 0;
    live = null;
    return Object.assign(discovered(), { ok: ok, syncing: false, syncLive: null, counts: counts, via: via, steps: steps, needLearn: needLearn,
      signIn: signIn,
      error: ok ? '' : signIn ? 'VB Studio needs you to sign in: click Open VB Studio, sign in as usual, close the window — then Sync again (Build.Rite keeps that session on this PC).'
        : pageOnly ? 'VB Studio sent its sign-in page instead of data: it does not take the username and password for these calls. Click Open VB Studio once and sign in — Sync then uses that session.'
          : refused ? 'VB Studio refused every call (see what Sync did).' : 'Nothing to ask VB Studio yet (see what Sync did).' });
  }

  /**
   * Find a project's repositories: { orgKey, project, name } → its repositories through VB Studio's API (when Build.Rite
   * knows that call), else the names VB Studio gives a project's first repository tried, each checked with git
   * (ls-remote, the saved sign-in): only one that exists is kept. → { ok, repos: [{ repo, url }], via, tried } + found.
   */
  async function findRepos(b) {
    b = b || {};
    const key = str(b.orgKey).toLowerCase();
    const pid = str(b.project);
    const m = /^([^/]+)\/([^/]+)$/.exec(key);
    if (!m || !pid) return { ok: false, error: 'Which project?' };
    const host = m[1], orgId = m[2];
    const saved = data.orgs.filter((x) => x.host === host && x.org === orgId)[0] || data.orgs.filter((x) => x.host === host)[0];
    if (!saved || !header(saved)) return { ok: false, error: 'Set up the organization first (its sign-in): Build.Rite asks VB Studio with it.' };
    const reposOf = () => { const d = data.discovered || {}; const p = (d.projects || []).filter((x) => x.host === host && x.org === orgId && x.project === pid)[0]; return (p && p.repos) || []; };
    const before = reposOf().length;
    if (discovered().learned.repos) {
      const r = await sync({ orgKey: key, project: pid });
      if (reposOf().length > before || (r.ok && reposOf().length)) return Object.assign(discovered(), { ok: true, repos: reposOf(), via: 'api', tried: [] });
    }
    // the names VB Studio gives a project's repository: the project's id, without its number, its name
    const nm = str(b.name).trim().toLowerCase();
    const names = [pid, pid.replace(/_\d+$/, ''), nm.replace(/\s+/g, '-'), nm.replace(/\s+/g, '_'), nm.replace(/\s+/g, '')]
      .map((x) => x.replace(/[^a-z0-9._-]/gi, '')).filter((x, i, a) => x && a.indexOf(x) === i);
    const tried = [], found = [];
    for (const n of names) {
      const url = 'https://' + host + '/' + orgId + '/s/' + orgId + '_' + pid + '/scm/' + n + '.git';
      const r = await git(['ls-remote', '--heads', url], saved, 30000);
      tried.push({ repo: n, ok: r.code === 0, why: r.code === 0 ? '' : why(r.stderr) });
      if (r.code === 0) { found.push({ repo: n, url: url }); break; }
      if (/refused|may not open/.test(why(r.stderr))) break; // the sign-in itself: no use trying other names
    }
    if (found.length) learn({ orgs: [], workspaces: [], calls: [], projects: [{ host: host, org: orgId, project: pid, name: str(b.name), description: '', repos: found }] });
    return Object.assign(discovered(), { ok: !!found.length, repos: found.length ? reposOf() : [], via: 'git', tried: tried,
      error: found.length ? '' : (tried.length && /refused|may not open/.test(tried[tried.length - 1].why) ? tried[tried.length - 1].why : 'No repository found under the names VB Studio usually gives (' + names.join(', ') + '). Open VB Studio, open this project\'s Repositories page, and Build.Rite reads its real address (and learns how, for every project).') });
  }

  return { state: state, saveOrg: saveOrg, removeOrg: removeOrg, addProject: addProject, checkProject: checkProject, removeProject: removeProject, auth: auth, git: git,
    learn: learn, discovered: discovered, clearDiscovered: clearDiscovered, diagnostic: diagnostic, setFinder: setFinder, finderLog: finderLog,
    sync: sync, findRepos: findRepos, windowSignIn: windowSignIn };
}

module.exports = { open, parseOrgUrl, parseRepoUrl, branchesOf, jobsOf, why, BUILT_IN };
