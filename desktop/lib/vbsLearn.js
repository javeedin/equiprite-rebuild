'use strict';
/**
 * Find in VB Studio (Build.Rite → Setup): what VB Studio's own pages load, read while someone browses VB Studio in a
 * window of Build.Rite (desktop/main.js, its DevTools network events) — VB Studio has no documented API that lists
 * organizations, projects or workspaces, so they are recognised in the JSON its pages get:
 *
 *   organizations  every VB Studio organization seen: in the addresses called (https://<host>/<org>/…) and in the data
 *                  (any VB Studio address in it)
 *   projects       a project id in the calls' addresses (…/rest/<org>_<project>/…), a Git address anywhere in the data
 *                  (…/<org>/s/<org>_<project>/scm/<repo>.git, the project and its repository — reliable), and the lists a
 *                  call about projects answers with (each item's name, id, description)
 *   workspaces     the lists a call about workspaces answers with: each item's name, its branch, repository, owner
 *
 * Only VB Studio's own hosts (…developer…oraclecloud.com) and never a sign-in call (oauth, token, sso, login, identity).
 * calls(): each call's path (ids as <org>, <project>, {n}) and the shape of its answer — field names only, never a value —
 * for "Copy what Build.Rite saw".
 *
 *   learner() → { see({ url, status, json }), found(), calls() }      merge(a, b) → a found merged with another
 */
const str = (v) => (v === undefined || v === null ? '' : String(v));
const SIGNIN = /oauth|token|\/sso\b|sso\/|login|logout|identity|saml|openid|authenticate|\/auth\//i;
const isVbsHost = (h) => /\.oraclecloud\.com$/i.test(h) && /developer/i.test(h);
const ORG_RE = /^[a-z0-9][a-z0-9-]{2,}$/;
const GIT_RE = /https:\/\/([a-z0-9.-]+)\/([a-z0-9][a-z0-9-]*)\/s\/([a-z0-9][a-z0-9-]*)_([A-Za-z0-9._-]+)\/scm\/([A-Za-z0-9._-]+?)(?:\.git)?(?=["'\s,)\]}]|$)/g;
const VBS_URL_RE = /https:\/\/([a-z0-9.-]*developer[a-z0-9.-]*\.oraclecloud\.com)\/([a-z0-9][a-z0-9-]{2,})(?=[/"'\s?#]|$)/gi;
const pick = (o, re) => { const k = Object.keys(o || {}).filter((x) => re.test(x))[0]; return k ? o[k] : undefined; };
const scalar = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? str(v.name || v.displayName || v.username || v.id || '') : str(v));

/** The shape of an answer: field names only (and of a list, its items' fields), never a value. */
function shapeOf(j, depth) {
  const d = depth || 0;
  if (Array.isArray(j)) return j.length ? '[' + j.length + '] ' + shapeOf(j[0], d + 1) : '[]';
  if (j && typeof j === 'object') {
    if (d > 4) return '{…}';
    return '{ ' + Object.keys(j).slice(0, 40).map((k) => (Array.isArray(j[k]) ? k + ': ' + shapeOf(j[k], d + 1) : j[k] && typeof j[k] === 'object' ? k + ': ' + shapeOf(j[k], d + 1) : k)).join(', ') + ' }';
  }
  return typeof j;
}
/** The lists in an answer (the answer itself, or its items / content / data / … field), with the path to each. */
function listsIn(j) {
  if (Array.isArray(j)) return [j];
  if (!j || typeof j !== 'object') return [];
  return Object.keys(j).filter((k) => Array.isArray(j[k]) && j[k].length && typeof j[k][0] === 'object').map((k) => j[k]);
}

function learner() {
  const orgs = {}, projects = {}, workspaces = {}, calls = {};
  const org = (host, id) => { if (!host || !ORG_RE.test(id)) return null; const k = host + '/' + id; if (!orgs[k]) orgs[k] = { host: host, org: id, url: 'https://' + host + '/' + id + '/' }; return orgs[k]; };
  const project = (host, o, id) => {
    if (!o || !id) return null;
    const k = host + '/' + o + '/' + id;
    if (!projects[k]) projects[k] = { host: host, org: o, project: id, name: '', description: '', repos: [] };
    return projects[k];
  };
  function see(r) {
    let u;
    try { u = new URL(str(r && r.url)); } catch (e) { return false; }
    if (!isVbsHost(u.hostname) || SIGNIN.test(u.pathname + u.search)) return false;
    const host = u.hostname.toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean);
    const o = parts[0] && ORG_RE.test(parts[0]) ? parts[0] : '';
    if (o) org(host, o);
    // …/rest/<org>_<project>/… : a project of that organization
    let pid = '';
    const ri = parts.indexOf('rest');
    if (o && ri !== -1 && parts[ri + 1] && parts[ri + 1].indexOf(o + '_') === 0) pid = parts[ri + 1].slice(o.length + 1);
    const si = parts.indexOf('s');
    if (o && !pid && si !== -1 && parts[si + 1] && parts[si + 1].indexOf(o + '_') === 0) pid = parts[si + 1].slice(o.length + 1);
    if (pid && !/^(pubapi|v\d+)$/i.test(pid)) project(host, o, pid);
    const j = r.json;
    if (j === undefined || j === null) return true;
    // the call, for "Copy what Build.Rite saw": its path (ids hidden) and the shape of its answer
    const path = '/' + parts.map((p, i) => ((i === 0 || p === o) && o ? '<org>' : (o && p.indexOf(o + '_') === 0 ? '<org>_<project>' : /^\d+$/.test(p) ? '{n}' : /^[0-9a-f-]{16,}$/i.test(p) ? '{id}' : p))).join('/');
    if (!calls[path]) calls[path] = { path: path, status: r.status || 0, shape: shapeOf(j) };
    const text = JSON.stringify(j);
    // every VB Studio address in the data: its organization
    let m;
    VBS_URL_RE.lastIndex = 0;
    while ((m = VBS_URL_RE.exec(text))) { if (!/^(s|rest|static|vbstudio|api)$/.test(m[2])) org(m[1].toLowerCase(), m[2].toLowerCase()); }
    // every Git address in the data: its project and repository (the reliable part)
    GIT_RE.lastIndex = 0;
    while ((m = GIT_RE.exec(text))) {
      if (m[3].toLowerCase() !== m[2].toLowerCase()) continue;
      const h = m[1].toLowerCase();
      org(h, m[2].toLowerCase());
      const pr = project(h, m[2].toLowerCase(), m[4]);
      const url = 'https://' + h + '/' + m[2] + '/s/' + m[3] + '_' + m[4] + '/scm/' + m[5] + '.git';
      if (pr && !pr.repos.some((x) => x.url === url)) pr.repos.push({ repo: m[5], url: url });
    }
    // a call about projects (its own address has a "projects" part, and is not inside one project): each listed item's
    // name, id, description — judged on the real address, never the one with its ids hidden
    const segs = parts.map((x) => x.toLowerCase());
    const aboutProjects = segs.some((x) => /^(projects?|projectlist|myprojects)$/.test(x)) && !pid && !segs.some((x) => /workspace|repositor|scm|cibuild|issues/.test(x));
    const aboutWorkspaces = segs.some((x) => /^workspaces?$|workspacelist/.test(x));
    if (o && aboutProjects) {
      listsIn(j).forEach((l) => l.forEach((it) => {
        if (!it || typeof it !== 'object') return;
        const id = scalar(pick(it, /^(identifier|projectId|projectIdentifier|id|key|name)$/i));
        const name = scalar(pick(it, /^(displayName|title|label|name)$/i));
        if (!id || /^\d+$/.test(id) && !name) return;
        const pr = project(host, o, id.indexOf(o + '_') === 0 ? id.slice(o.length + 1) : id);
        if (pr) { if (name && !pr.name) pr.name = name; const d = scalar(pick(it, /^description$/i)); if (d && !pr.description) pr.description = d.slice(0, 300); }
      }));
    }
    // a call about workspaces: each listed item's name, branch, repository, owner
    if (o && aboutWorkspaces) {
      listsIn(j).forEach((l) => l.forEach((it) => {
        if (!it || typeof it !== 'object') return;
        const name = scalar(pick(it, /^(name|displayName|title|workspaceName)$/i));
        if (!name) return;
        const branch = scalar(pick(it, /branch/i));
        const repoV = scalar(pick(it, /^(repository|repositoryName|repo|repoName|gitRepository|repositoryUrl|gitUrl)$/i));
        const owner = scalar(pick(it, /^(owner|ownerName|createdBy|creator|user|userName|author)$/i));
        const ws = { host: host, org: o, project: pid || scalar(pick(it, /^(project|projectId|projectName|projectIdentifier)$/i)), name: name, branch: branch, repo: repoV.replace(/^.*\/scm\//, '').replace(/\.git$/, ''), owner: owner,
          id: scalar(pick(it, /^(id|workspaceId|identifier)$/i)) };
        const k = host + '/' + o + '/' + (ws.project || '') + '/' + (ws.id || ws.name);
        workspaces[k] = Object.assign(workspaces[k] || {}, ws);
      }));
    }
    return true;
  }
  return {
    see: see,
    found: () => ({ orgs: Object.keys(orgs).map((k) => orgs[k]), projects: Object.keys(projects).map((k) => projects[k]), workspaces: Object.keys(workspaces).map((k) => workspaces[k]) }),
    calls: () => Object.keys(calls).map((k) => calls[k]),
  };
}

/** A found merged into another (what is new added; what is known kept, filled in where it was empty). */
function merge(a, b) {
  const out = { orgs: (a && a.orgs || []).slice(), projects: (a && a.projects || []).map((p) => Object.assign({}, p, { repos: (p.repos || []).slice() })), workspaces: (a && a.workspaces || []).slice(), calls: (a && a.calls || []).slice() };
  ((b && b.orgs) || []).forEach((o) => { if (!out.orgs.some((x) => x.host === o.host && x.org === o.org)) out.orgs.push(o); });
  ((b && b.projects) || []).forEach((p) => {
    const x = out.projects.filter((y) => y.host === p.host && y.org === p.org && y.project === p.project)[0];
    if (!x) { out.projects.push(Object.assign({}, p, { repos: (p.repos || []).slice() })); return; }
    if (!x.name && p.name) x.name = p.name;
    if (!x.description && p.description) x.description = p.description;
    (p.repos || []).forEach((r) => { if (!x.repos.some((y) => y.url === r.url)) x.repos.push(r); });
  });
  ((b && b.workspaces) || []).forEach((w) => {
    const k = (y) => y.host + '/' + y.org + '/' + (y.project || '') + '/' + (y.id || y.name);
    const i = out.workspaces.findIndex((y) => k(y) === k(w));
    if (i === -1) out.workspaces.push(w); else out.workspaces[i] = Object.assign({}, out.workspaces[i], w);
  });
  ((b && b.calls) || []).forEach((c) => { if (!out.calls.some((x) => x.path === c.path)) out.calls.push(c); });
  return out;
}

module.exports = { learner, merge, shapeOf, isVbsHost, SIGNIN };
