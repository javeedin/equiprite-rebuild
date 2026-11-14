define([], function () {
  'use strict';

  // VB Studio as Build.Rite shows it (Setup → Organizations & projects, and a project's own tab): what desktop/lib/vbs.js
  // found — organizations, projects, their repositories and workspaces — turned into what the screens list. Pure.
  //
  //   projKey(p)               '<host>/<org>/<project>', a project's key (its tab's too)
  //   wsMatch(w, p)            a workspace of that project: by the project's id, or (read without it) its short name (the
  //                            id without its number) or its name
  //   projectRows(found, fOrg, fText)   the projects listed: name, id, organization, repositories, workspaces
  //   project(found, key)      one project: its repositories (added to Build.Rite or not) and its workspaces, as VB Studio
  //                            lists them (workspace, owner, repository, branch, environment, last opened)
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function when(at) {
    var d = new Date(at);
    if (isNaN(d.getTime())) return '';
    var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function projKey(p) { return p.host + '/' + p.org + '/' + p.project; }
  function orgKey(o) { return o.host + '/' + o.org; }
  function wsMatch(w, p) {
    return w.host === p.host && w.org === p.org && !!w.project
      && (w.project === p.project || w.project === String(p.project).replace(/_\d+$/, '') || (!!p.name && w.project === p.name));
  }
  function wsOf(found, p) { return ((found && found.workspaces) || []).filter(function (w) { return wsMatch(w, p); }); }
  /** When a workspace was last opened: a date (or seconds / milliseconds) shown as a date, else as VB Studio says it. */
  function opened(v) {
    var t = String(v === undefined || v === null ? '' : v);
    if (!t) return '—';
    var n = /^\d{10}$/.test(t) ? Number(t) * 1000 : /^\d{12,13}$/.test(t) ? Number(t) : t;
    var d = new Date(n);
    return isNaN(d.getTime()) ? t : when(d.toISOString());
  }
  function openedAt(v) { var t = String(v || ''); var n = /^\d{10}$/.test(t) ? Number(t) * 1000 : /^\d{12,13}$/.test(t) ? Number(t) : t; var d = new Date(n); return isNaN(d.getTime()) ? 0 : d.getTime(); }
  // an address part as VB Studio writes it: encoded, its slashes kept
  function enc(v) { return encodeURIComponent(String(v === undefined || v === null ? '' : v)).replace(/%2F/g, '/'); }
  /** The project's short id, as VB Studio's own addresses use it (its id without its number): my-app_123456 → my-app. */
  function shortId(project) { return String(project || '').replace(/_\d+$/, ''); }
  /**
   * A workspace opened in VB Studio's designer, as VB Studio opens it (Workspaces → a workspace):
   * https://<host>/<org>/uiext/vbdt/index.html?projectId=<org>_<project>&organizationId=<org>&organizationName=<org>
   *   &projectUrlId=<short id>&restUrl=s2/<org>_<project>/vbdt/&workspaceName=<name>&launchedFromUrl=/<org>/&serverRoot=/
   *   [&root=application&application=<its application>]
   */
  function designerUrl(p, w) {
    var full = p.org + '_' + p.project;
    var q = ['projectId=' + enc(full), 'organizationId=' + enc(p.org), 'organizationName=' + enc(p.org), 'projectUrlId=' + enc(shortId(p.project)),
      'restUrl=' + enc('s2/' + full + '/vbdt/'), 'workspaceName=' + enc(w.name), 'launchedFromUrl=' + enc('/' + p.org + '/'), 'serverRoot=' + enc('/')];
    if (w.appId) q.push('root=application', 'application=' + enc(w.appId));
    return 'https://' + p.host + '/' + p.org + '/uiext/vbdt/index.html?' + q.join('&');
  }
  /** The workspace's repository among the project's (by name, with or without .git), else its address made the way VB Studio makes it. */
  function repoOf(p, name) {
    var n = String(name || '').replace(/\.git$/i, '');
    if (!n) return null;
    var r = (p.repos || []).filter(function (x) { return String(x.repo || '').toLowerCase() === n.toLowerCase(); })[0];
    return { repo: r ? r.repo : n, url: r ? r.url : 'https://' + p.host + '/' + p.org + '/s/' + p.org + '_' + p.project + '/scm/' + n + '.git', added: !!(r && r.added) };
  }
  /** The repository at the workspace's branch in VB Studio's Git page (Git → the repository → the branch). */
  function gitPageUrl(p, repo, branch) {
    return 'https://' + p.host + '/' + p.org + '/#projects/' + enc(shortId(p.project)) + '/scm/' + enc(repo) + '.git/tree/' + (branch ? '?revision=' + enc(branch) : '');
  }
  function wsRow(w, p) {
    var r = p ? repoOf(p, w.repo) : null;
    return { key: (w.id || w.name), name: w.name, owner: w.owner || '', branch: w.branch || '—', branchName: w.branch || '', repo: (r && r.repo) || w.repo || '—', environment: w.environment || '—',
      lastOpened: opened(w.lastOpened), url: w.url || '', designer: p ? designerUrl(p, w) : (w.url || ''), clone: r ? r.url : '', gitPage: p && r ? gitPageUrl(p, r.repo, w.branch) : '',
      appId: w.appId || '' };
  }
  function matches(p, t) {
    var q = String(t || '').trim().toLowerCase();
    return !q || [p.name, p.project, p.description].some(function (v) { return String(v || '').toLowerCase().indexOf(q) !== -1; });
  }
  /** The projects listed (an organization's, matching the search): the most workspaces first, then by name. */
  function projectRows(found, fOrg, fText) {
    return ((found && found.projects) || [])
      .filter(function (p) { return (!fOrg || orgKey(p) === fOrg) && matches(p, fText); })
      .map(function (p) {
        var n = wsOf(found, p).length;
        var r = (p.repos || []).length;
        return { key: projKey(p), name: p.name || p.project, project: p.project, org: p.org, description: p.description || '',
          repos: r, ws: n, reposText: r ? plural(r, 'repository', 'repositories') : '—', wsText: n ? plural(n, 'workspace') : '—' };
      })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' }); });
  }
  /** One project: its repositories and workspaces (the last opened first); null when it is not among what was found. */
  function project(found, key) {
    var p = ((found && found.projects) || []).filter(function (x) { return projKey(x) === key; })[0];
    if (!p) return null;
    var ws = wsOf(found, p).slice().sort(function (a, b) { return openedAt(b.lastOpened) - openedAt(a.lastOpened) || String(a.name).localeCompare(String(b.name)); });
    return { key: projKey(p), orgKey: orgKey(p), host: p.host, org: p.org, name: p.name || p.project, project: p.project, description: p.description || '', orgSetUp: !!p.orgId,
      repos: (p.repos || []).map(function (r) { return { repo: r.repo, url: r.url, added: !!r.added }; }),
      workspaces: ws.map(function (w) { return wsRow(w, p); }) };
  }

  return { designerUrl: designerUrl, gitPageUrl: gitPageUrl, repoOf: repoOf, shortId: shortId, when: when, plural: plural, projKey: projKey, orgKey: orgKey, wsMatch: wsMatch, wsOf: wsOf, opened: opened, wsRow: wsRow, matches: matches, projectRows: projectRows, project: project };
});
