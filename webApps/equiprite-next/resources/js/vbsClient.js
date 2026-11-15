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
    /** The working copy: a workspace cloned on this PC; checked, pulled, committed, pushed back to VB Studio. */
    work: function () { return call('work'); },
    workPlan: function (b) { return post('work/plan', b); },
    workUse: function (b) { return post('work/use', b); },
    workApply: function (id) { return post('work/apply', { id: id || '' }); },
    /** Setting a workspace up: its progress (git's own: phase, percentage, size, speed, each step), and Cancel. */
    workProgress: function () { return call('work/progress'); },
    workCancel: function () { return post('work/cancel', {}); },
    /** The desktop app's folder dialog: the folder chosen, or '' (cancelled). */
    pickFolder: function (folder) { return post('pick-folder', { folder: folder || '' }); },
    workStatus: function (id, fetch) { return post('work/status', { id: id || '', fetch: !!fetch }); },
    workPull: function (id) { return post('work/pull', { id: id || '' }); },
    workCommit: function (id, message) { return post('work/commit', { id: id || '', message: message }); },
    workPush: function (id) { return post('work/push', { id: id || '' }); },
    workForget: function (id, removeFolder) { return post('work/forget', { id: id || '', removeFolder: !!removeFolder }); },
    /** Stop using the current workspace (its folders kept). */
    workStop: function () { return post('work/stop', {}); },
    workRun: function (app) { return post('work/run', { app: app || '' }); },
    /** What ▶ Run says once it answered (the top bar and Application pages say the same): { ok, text, tone }. */
    runText: function (r) {
      var b = (r && r.body) || {};
      if (!(r && r.ok && b.ok)) return { ok: false, text: b.error || 'It could not be run.', tone: 'error' };
      var ch = Array.isArray(b.changed) ? b.changed : null;
      var names = ch ? ch.slice(0, 3).map(function (f) { return String(f).split('/').pop(); }).join(', ') + (ch.length > 3 ? ' and ' + (ch.length - 3) + ' more' : '') : '';
      var base = b.base || 'VB Studio';
      var what = ch == null ? '' : (ch.length ? ' Your ' + ch.length + ' change' + (ch.length === 1 ? '' : 's') + ' since ' + base + ' are in it: ' + names + '.' : ' It has no change since ' + base + ': it is the same as VB Studio has.');
      return { ok: true, tone: 'success', text: '▶ ' + b.app + ' is running in its own window — your working copy (' + (b.branch || 'buildrite-working') + '), '
        + (b.built ? 'built just now (' + (Math.round((b.ms || 0) / 100) / 10) + ' s)' : 'no change since its last build') + '.' + what + ' Run again after more changes.' };
    },
    /**
     * Remove the current workspace from this PC, asked first — what would be lost said (changes not saved, not applied, not
     * pushed): its folders deleted, forgotten. → { ok, body } or { ok: false, body: { cancelled } } when not confirmed.
     */
    workRemove: function (c) {
      if (!c) return Promise.resolve({ ok: false, status: 0, body: { error: 'No workspace is in use.' } });
      return post('work/status', { id: c.id, fetch: false }).then(function (st) {
        var s = (st.ok && st.body) || {};
        var lost = [];
        if (s.changed) lost.push(s.changed + ' change' + (s.changed === 1 ? '' : 's') + ' in working not saved');
        if (s.toApply) lost.push(s.toApply + ' saved change' + (s.toApply === 1 ? '' : 's') + ' not applied to main');
        if (s.toPush) lost.push(s.toPush + ' commit' + (s.toPush === 1 ? '' : 's') + ' not pushed to VB Studio');
        var msg = 'Remove ' + c.projectName + ' ▸ ' + c.workspace + ' from this PC?\n\nIts folder is deleted (working and main):\n' + c.base +
          (lost.length ? '\n\nThese would be lost: ' + lost.join('; ') + '.' : '\n\nEverything in it is in VB Studio already: nothing is lost.') + '\n\nNothing changes in VB Studio.';
        var ask = function (t) { return typeof window === 'undefined' || !window.confirm ? true : window.confirm(t); };
        if (!ask(msg)) return { ok: false, status: 0, body: { cancelled: true } };
        return post('work/forget', { id: c.id, removeFolder: true }).then(function (r) {
          // Windows refusing (the folder in use): remove it from Build.Rite only, its folder kept — asked
          if (r.ok || !(r.body && r.body.inUse)) return r;
          if (!ask(r.body.error + '\n\nRemove it from Build.Rite only? Its folder stays at:\n' + r.body.path + '\n(delete it yourself once nothing has it open).')) return r;
          return post('work/forget', { id: c.id, removeFolder: false }).then(function (r2) { if (r2.ok) r2.body.keptFolder = r.body.path; return r2; });
        });
      });
    },
    workOpen: function (id, which) { return post('work/open', { id: id || '', which: which || 'working' }); },
    findRepos: function (orgKey, project, name) { return post('repos', { orgKey: orgKey, project: project, name: name || '' }); },
  };
});
