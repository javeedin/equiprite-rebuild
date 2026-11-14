define(['vb/action/actionChain', 'resources/js/vbsClient', 'resources/js/vbsView', 'resources/js/shellBus'], (ActionChain, VC, V, bus) => {
  'use strict';

  // A project's tab: Refresh workspaces (this project's workspaces and repositories read again from VB Studio — from
  // inside VB Studio's own page, desktop/lib/vbs.js); signed out of VB Studio: its window opened to sign in, and the
  // refresh run again once it is closed; a repository added to Build.Rite (checked: sign-in, branches, build jobs) or
  // found; a workspace opened in VB Studio; what the refresh did copied.
  let watcher = null;
  const copy = async (text) => {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* fall back */ }
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok; } catch (e) { return false; }
  };
  class actChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      const parts = String(v.key || '').split('/');
      const orgKey = parts.slice(0, 2).join('/');
      const pid = parts.slice(2).join('/');
      const p = V.project(v.found, v.key);
      // the workspace chosen: its Git read at once (never blocked by a refresh)
      const readGit = async () => {
        const w = p && p.workspaces.filter((x) => x.key === v.wsSel)[0];
        if (!w) return;
        const sel = v.wsSel;
        if (!w.repo || w.repo === '—') { v.wsGit = { ok: false, error: 'VB Studio did not say which repository it uses.' }; return; }
        v.wsGitBusy = true;
        try {
          const r = await VC.workspaceGit(orgKey, pid, w.repo, w.branchName);
          if (v.wsSel === sel) v.wsGit = Object.assign({}, r.body, { ok: !!r.ok });
        } finally { if (v.wsSel === sel) v.wsGitBusy = false; }
      };
      if (act === 'selectWs') {
        if (v.wsSel === String(key || '') && v.wsGit) return;
        v.wsSel = String(key || ''); v.wsGit = null;
        setTimeout(() => { try { const e = document.querySelector('#vbspWsPanel'); if (e && e.offsetParent && e.scrollIntoView) e.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (er) { /* not drawn */ } }, 60);
        await readGit();
        return;
      }
      if (act === 'closeWs') { v.wsSel = ''; v.wsGit = null; return; }
      if (act === 'gitRead') { await readGit(); return; }
      if (act === 'copyText') {
        const ok = await copy(String(key || ''));
        v.result = ok ? { ok: true, text: 'Copied: ' + String(key || '').slice(0, 120) + (String(key || '').length > 120 ? '…' : '') } : { ok: false, text: 'Could not copy here.' };
        return;
      }
      if (act === 'openWs') {
        // the workspace in VB Studio's designer, in Build.Rite's VB Studio window (signed in there)
        const r = await VC.find(String(key || ''));
        v.result = r.ok ? { ok: true, text: 'Opening the workspace in Build.Rite\'s VB Studio window (sign in there if VB Studio asks).' } : { ok: false, text: r.body.error || 'Could not open VB Studio.' };
        return;
      }
      if (act === 'copySteps') {
        const ok = await copy(((v.refresh && v.refresh.steps) || []).map((s) => s.at + '  ' + s.text).join('\n'));
        v.result = ok ? { ok: true, text: 'Copied what the refresh did (addresses with their ids hidden, no password). Paste it to Claude.' } : { ok: false, text: 'Could not copy here.' };
        return;
      }
      if (v.busy) return;
      v.busy = true;
      try {
        if (act === 'refresh') {
          v.refreshing = true; v.result = null;
          let r;
          try { r = await VC.sync({ orgKey: orgKey, project: pid }); } finally { v.refreshing = false; }
          if (r.body && Array.isArray(r.body.projects)) v.found = r.body;
          const np = V.project(v.found, v.key);
          v.refresh = { at: new Date().toISOString(), ok: !!r.ok, error: (r.body && r.body.error) || '', signIn: !!(r.body && r.body.signIn), steps: (r.body && r.body.steps) || [] };
          v.stepsOpen = !r.ok;
          if (r.ok) bus.emit('vbs-changed', { key: v.key });
          v.result = r.ok
            ? { ok: true, text: 'Read from VB Studio: ' + V.plural(np ? np.workspaces.length : 0, 'workspace') + ', ' + V.plural(np ? np.repos.length : 0, 'repository', 'repositories') + '.' }
            : { ok: false, text: (r.body && r.body.error) || 'VB Studio did not answer.' };
          return;
        }
        if (act === 'signIn') {
          // VB Studio's window, at the organization's page: signed in there, closed — then the refresh runs again
          const r = await VC.find('https://' + orgKey + '/');
          if (!r.ok) { v.result = { ok: false, text: r.body.error || 'Could not open VB Studio.' }; return; }
          v.signingIn = true;
          v.result = { ok: true, text: 'Sign in to VB Studio in its window, then close it: the workspaces are read again by themselves.' };
          if (watcher) clearInterval(watcher);
          const until = Date.now() + 15 * 60000;
          watcher = setInterval(async () => {
            const f = await VC.discovered();
            if (Date.now() < until && !(f.ok && f.body.finder && !f.body.finder.open)) return;
            clearInterval(watcher); watcher = null; v.signingIn = false;
            v.busy = false;
            await this.run(context, { act: 'refresh', key: '' });
          }, 2500);
          return;
        }
        if (act === 'addRepo') {
          const s = await VC.state();
          const org = s.ok ? (s.body.orgs || []).filter((o) => o.host + '/' + o.org === orgKey)[0] : null;
          if (!org) { v.result = { ok: false, text: 'Set up its organization first (Organizations & projects → Add): Build.Rite checks the repository with its sign-in.' }; return; }
          const r = await VC.addProject({ orgId: org.id, repoUrl: String(key || ''), name: p ? p.name : '' });
          if (!r.ok) { v.result = { ok: false, text: r.body.error || 'Not added.' }; return; }
          const f = await VC.discovered();
          if (f.ok) v.found = f.body;
          bus.emit('vbs-changed', { key: v.key });
          v.result = { ok: true, text: 'Added to Build.Rite and checked: ' + r.body.project.repo + ' — signed in; ' + r.body.project.branches.length + ' branches, ' + r.body.project.jobs.length + ' build jobs.' };
          return;
        }
        if (act === 'findRepos') {
          const r = await VC.findRepos(orgKey, pid, p ? p.name : '');
          if (r.body && Array.isArray(r.body.projects)) v.found = r.body;
          const np = V.project(v.found, v.key);
          v.result = r.ok ? { ok: true, text: 'Found: ' + ((np && np.repos) || []).map((x) => x.repo).join(', ') + (r.body.via === 'git' ? ' (checked with git: it exists).' : ' (from VB Studio).') } : { ok: false, text: r.body.error || 'Not found.' };
          return;
        }
        if (act === 'openVbs') {
          const r = await VC.find(String(key || ''));
          v.result = r.ok ? { ok: true, text: 'Opened in Build.Rite\'s VB Studio window.' } : { ok: false, text: r.body.error || 'Could not open VB Studio.' };
        }
      } finally {
        v.busy = false;
      }
    }
  }
  return actChain;
});
