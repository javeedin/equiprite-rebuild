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
 * calls(): each call's path (ids as <org>, <project>, {n}), what it is for (projects, repos, workspaces, orgs), its
 * paging and sorting parameters, and the shape of its answer — field names only, never a value — for "Copy what
 * Build.Rite saw", and for Sync, which makes the same calls through VB Studio's API (lib/vbs.js).
 *
 *   learner() → { see({ url, status, json, auth }), found(), calls() }   merge(a, b) → a found merged with another
 *   roleOf(parts, pid), roleOfPath(path) → what a call is for          listsIn(json) → the lists in an answer
 */
const str = (v) => (v === undefined || v === null ? '' : String(v));
const SIGNIN = /oauth|token|\/sso\b|sso\/|login|logout|identity|saml|openid|authenticate|\/auth\//i;
const isVbsHost = (h) => /\.oraclecloud\.com$/i.test(h) && /developer/i.test(h);
const ORG_RE = /^[a-z0-9][a-z0-9-]{2,}$/;
// the first part of a VB Studio address that is not an organization (its services, its files)
const NOT_ORG = /^(s\d*|rest|static|vbstudio|api\d*|v\d+|ui|public|assets|resources|js|css|img|images|fonts|cdn|dist|libs?|favicon|help|docs|status|health|metrics|socket|ws|graphql|oauth2?|sso|idcs|signin|login|logout|auth|scm|git|maven|npm|registry|webhooks?|hooks|cloudgate|site|profiles?|users?|groups?|activity|feedback|ping|appconfig|orgconfig|docker|ocicompute|dockerexecutor|vbdt|design|environment|projects?|workspaces?|organization)$/i;
/** An organization's id: its shape, and not one of VB Studio's own services (api2, static, rest…). */
const isOrgId = (id) => ORG_RE.test(str(id)) && !NOT_ORG.test(str(id));
const GIT_RE = /https:\/\/([a-z0-9.-]+)\/([a-z0-9][a-z0-9-]*)\/s\/([a-z0-9][a-z0-9-]*)_([A-Za-z0-9._-]+)\/scm\/([A-Za-z0-9._-]+?)(?:\.git)?(?=["'\s,)\]}]|$)/g;
const VBS_URL_RE = /https:\/\/([a-z0-9.-]*developer[a-z0-9.-]*\.oraclecloud\.com)\/([a-z0-9][a-z0-9-]{2,})(?=\/?(?:["'\s?#]|$)|\/#|\/(?:s\d*|rest|api2)\/)/gi;
const AUTH_KINDS = /^(basic|bearer|cookie|session|page)$/;
const pick = (o, re) => { const k = Object.keys(o || {}).filter((x) => re.test(x))[0]; return k ? o[k] : undefined; };
const scalar = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? str(v.name || v.displayName || v.username || v.id || '') : str(v));

/**
 * What a call is for, from its address's parts (the real ones, or a recorded path with its ids hidden), by its last part:
 * 'projects' (the organization's projects: …/projects, not inside one project), 'workspaces' (…/workspaces), 'repos'
 * (one project's …/repositories or …/repository), 'orgs', or ''. pid: the project the address is inside ('<project>' in a
 * recorded path).
 */
function roleOf(parts, pid) {
  const sg = (parts || []).map((x) => str(x).toLowerCase());
  if (pid === undefined) pid = sg.some((x) => x === '<org>_<project>') ? '<project>' : '';
  const last = sg[sg.length - 1] || '';
  if (/^(projects?|projectlist|myprojects)$/.test(last) && !pid && !sg.some((x) => /workspace|repositor|scm|cibuild|issues/.test(x))) return 'projects';
  if (/^(workspaces|workspacelist)$/.test(last)) return 'workspaces';
  if (pid && /^(repositories|repos|repository)$/.test(last)) return 'repos';
  if (/^(organizations|orgs)$/.test(last)) return 'orgs';
  return '';
}
/** A recorded path's role (calls recorded before roles were kept have none: read again from the path). */
const roleOfPath = (path) => roleOf(str(path).split('/').filter(Boolean));

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
  const org = (host, id) => { if (!host || !isOrgId(id)) return null; const k = host + '/' + id; if (!orgs[k]) orgs[k] = { host: host, org: id, url: 'https://' + host + '/' + id + '/' }; return orgs[k]; };
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
    const o = parts[0] && isOrgId(parts[0]) ? parts[0] : '';
    if (o) org(host, o);
    // …/<org>_<project>/… (after /rest/, /s/, /s2/, /docker/, …): a project of that organization
    let pid = '';
    const pi = o ? parts.findIndex((x, i) => i > 0 && x.toLowerCase().indexOf(o.toLowerCase() + '_') === 0 && x.length > o.length + 1) : -1;
    if (pi !== -1) pid = parts[pi].slice(o.length + 1);
    if (/^(pubapi|v\d+)$/i.test(pid)) pid = '';
    if (pid) project(host, o, pid);
    const j = r.json;
    if (j === undefined || j === null) return true;
    // the call, for "Copy what Build.Rite saw": its path (ids hidden) and the shape of its answer
    const path = '/' + parts.map((p, i) => ((i === 0 || p === o) && o ? '<org>' : (o && p.indexOf(o + '_') === 0 ? '<org>_<project>' : /^\d+$/.test(p) ? '{n}' : /^[0-9a-f-]{16,}$/i.test(p) ? '{id}' : p))).join('/');
    const role = roleOf(parts, pid);
    // its query, kept for the same call through the API: paging, sorting and view parameters only (never anything else)
    const SAFE_Q = /^(offset|limit|page|size|pagesize|pagenumber|start|count|max|maxresults|sort|sortby|order|orderby|fields|expand|status|type|view|scope|include|filter|archived|deleted)$/i;
    const query = Array.from(u.searchParams.keys()).filter((k) => SAFE_Q.test(k)).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(u.searchParams.get(k))).join('&');
    if (!calls[path] || (role && !calls[path].role)) calls[path] = { path: path, role: role, query: query, status: r.status || 0, shape: shapeOf(j), auth: AUTH_KINDS.test(str(r.auth)) ? str(r.auth) : '' };
    const text = JSON.stringify(j);
    // every VB Studio address in the data: its organization
    let m;
    VBS_URL_RE.lastIndex = 0;
    while ((m = VBS_URL_RE.exec(text))) org(m[1].toLowerCase(), m[2].toLowerCase());
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
    const aboutProjects = role === 'projects';
    const aboutWorkspaces = role === 'workspaces';
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
        const env = pick(it, /^(environment|environmentName|env|targetEnvironment)$/i);
        const opened = scalar(pick(it, /^(lastOpened|lastOpenedDate|lastOpenedTime|lastAccessed|lastAccessTime|lastUsed|lastModified|modifiedDate|modifiedTime|updatedAt|updated|updateTime)$/i));
        const link = scalar(pick(it, /^(url|href|link|designerUrl|webUrl|workspaceUrl)$/i));
        // its visual application's id, as VB Studio's designer opens it (application=<org>_<project>_<app>): a field named so,
        // else any value that starts like it (one level deep), else an id shaped like one (741-1.0)
        const full = o + '_' + (pid || scalar(pick(it, /^(project|projectId|projectIdentifier)$/i)));
        let appId = scalar(pick(it, /^(applicationId|appId|vbApplicationId|visualApplicationId|application)$/i));
        const starts = (v) => typeof v === 'string' && v.indexOf(full + '_') === 0 && v.length > full.length + 1;
        if (!starts(appId)) {
          const vals = [];
          Object.keys(it).forEach((k) => { const x = it[k]; if (x && typeof x === 'object' && !Array.isArray(x)) Object.keys(x).forEach((k2) => vals.push(x[k2])); else vals.push(x); });
          const hit = vals.filter(starts)[0];
          const wid = scalar(pick(it, /^(id|workspaceId|identifier)$/i));
          appId = hit || (/^[0-9a-z]+-\d+(\.\d+)+$/i.test(appId) ? full + '_' + appId : /^\d+-\d+(\.\d+)+$/.test(wid) ? full + '_' + wid : '');
        }
        const ws = { host: host, org: o, project: pid || scalar(pick(it, /^(project|projectId|projectName|projectIdentifier)$/i)), name: name, branch: branch, repo: repoV.replace(/^.*\/scm\//, '').replace(/\.git$/, ''), owner: owner,
          environment: env && typeof env === 'object' ? str(env.name || env.displayName || env.id || '') : str(env || ''), lastOpened: opened,
          appId: appId,
          url: /^https:\/\//.test(link) && isVbsHost((() => { try { return new URL(link).hostname; } catch (e) { return ''; } })()) ? link : '',
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
  const known = {};
  out.projects.forEach((p) => { known[p.host + '/' + p.org + '/' + p.project] = true; });
  ((b && b.workspaces) || []).forEach((w) => {
    if (w.project) {
      out.workspaces = out.workspaces.filter((y) => !(y.host === w.host && y.org === w.org && (y.id && w.id ? y.id === w.id : y.name === w.name) && !known[y.host + '/' + y.org + '/' + y.project]));
    }
    const k = (y) => y.host + '/' + y.org + '/' + (y.project || '') + '/' + (y.id || y.name);
    const i = out.workspaces.findIndex((y) => k(y) === k(w));
    if (i === -1) out.workspaces.push(w); else out.workspaces[i] = Object.assign({}, out.workspaces[i], w);
  });
  ((b && b.calls) || []).forEach((c) => {
    const i = out.calls.findIndex((x) => x.path === c.path);
    if (i === -1) out.calls.push(c);
    else if ((c.role && !out.calls[i].role) || (c.query && !out.calls[i].query) || (c.auth && !out.calls[i].auth)) out.calls[i] = Object.assign({}, out.calls[i], c);
  });
  return out;
}

module.exports = { learner, merge, shapeOf, isVbsHost, isOrgId, roleOf, roleOfPath, listsIn, SIGNIN };
