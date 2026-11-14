define([], function () {
  'use strict';

  // Setup → Organizations & projects (Build.Rite; desktop/lib/vbs.js does the work): the VB Studio organizations, their
  // sign-in (kept encrypted on this PC, never sent back here) and their projects. The local server only (/__vbs/*,
  // X-EquipRite-Vbs): the desktop app. Each call resolves { ok, status, body } and never throws.
  function call(path, method, body) {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return Promise.resolve({ ok: false, status: 0, body: { error: 'Not in a browser.' } });
    var opts = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { 'X-EquipRite-Vbs': '1' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return window.fetch('/__vbs/' + path, opts).then(function (r) {
      return r.text().then(function (t) {
        var b = null;
        try { b = t ? JSON.parse(t) : null; } catch (e) { b = { error: r.ok ? 'An answer that is not JSON.' : 'HTTP ' + r.status }; }
        return { ok: r.ok && !!b && b.ok !== false, status: r.status, body: b || {} };
      });
    }, function (e) { return { ok: false, status: 0, body: { error: 'The local server did not answer: ' + ((e && e.message) || e) } }; });
  }
  var post = function (p, b) { return call(p, 'POST', b || {}); };
  return {
    state: function () { return call('state'); },
    saveOrg: function (b) { return post('org', b); },
    removeOrg: function (id) { return post('org/remove', { id: id }); },
    addProject: function (b) { return post('project', b); },
    checkProject: function (id) { return post('project/check', { id: id }); },
    removeProject: function (id) { return post('project/remove', { id: id }); },
    /** Find in VB Studio: VB Studio opened in a window of the desktop app; what its pages load, read as you browse. */
    find: function (url) { return post('find', { url: url || '' }); },
    discovered: function () { return call('discovered'); },
    diagnostic: function () { return call('diagnostic'); },
    clearDiscovered: function () { return post('discovered/clear', {}); },
    /** Sync from VB Studio (API, no window): every project (all pages), its repositories and workspaces. */
    sync: function (o) { return post('sync', typeof o === 'object' && o ? o : { orgId: o || '' }); },
    /** Find a project's repositories: VB Studio's API, else the names VB Studio usually gives (each checked with git). */
    /** A workspace's Git: its branch, head commit and last commit (who, when, what, the files it changed). */
    workspaceGit: function (orgKey, project, repo, branch) { return post('workspace-git', { orgKey: orgKey, project: project, repo: repo, branch: branch }); },
    findRepos: function (orgKey, project, name) { return post('repos', { orgKey: orgKey, project: project, name: name || '' }); },
  };
});
