define(['vb/action/actionChain', 'resources/js/vbsClient'], (ActionChain, VC) => {
  'use strict';

  // Setup → Organizations & projects: an organization chosen, added, edited (its sign-in saved encrypted on this PC; the
  // password field emptied at once), removed; a project added by its Git address (checked: the sign-in, its branches, its
  // build jobs), checked again, removed.
  // Find in VB Studio: what the VB Studio window finds, read again every few seconds while it is open (at most 30 minutes)
  let watcher = null;
  const watch = (v) => {
    if (watcher) clearInterval(watcher);
    const until = Date.now() + 30 * 60000;
    v.watching = true;
    watcher = setInterval(async () => {
      const f = await VC.discovered();
      if (f.ok) v.found = f.body;
      setTimeout(() => { try { const e = document.getElementById('vbsFinderLogText'); if (e) e.scrollTop = e.scrollHeight; } catch (er) { /* not drawn */ } }, 50);
      if (Date.now() > until || (f.ok && f.body.finder && !f.body.finder.open)) {
        clearInterval(watcher); watcher = null; v.watching = false;
        const s = await VC.state();
        if (s.ok) { v.orgs = s.body.orgs; v.projects = s.body.projects; }
      }
    }, 2500);
  };
  const copy = async (text) => {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* fall back */ }
    try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok; } catch (e) { return false; }
  };
  const ask = (t) => (typeof window === 'undefined' || !window.confirm ? true : window.confirm(t));
  const clearBox = (id) => { try { const e = document.getElementById(id); if (e) e.value = ''; } catch (er) { /* not drawn */ } };
  const fill = (id, val) => { try { const e = document.getElementById(id); if (e) e.value = val; } catch (er) { /* not drawn */ } };
  class actChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      if (act === 'selOrg') { v.selOrg = key; v.result = null; return; }
      if (act === 'newOrg') { v.formOrg = true; v.editId = ''; v.oName = ''; v.oUrl = ''; v.oUser = ''; v.oPass = ''; setTimeout(() => ['vbsOName', 'vbsOUrl', 'vbsOUser', 'vbsOPass'].forEach(clearBox), 0); return; }
      if (act === 'editOrg') {
        const o = (v.orgs || []).filter((x) => x.id === key)[0];
        if (!o) return;
        v.formOrg = true; v.editId = o.id; v.oName = o.name; v.oUrl = o.url; v.oUser = o.user; v.oPass = '';
        setTimeout(() => { fill('vbsOName', o.name); fill('vbsOUrl', o.url); fill('vbsOUser', o.user); clearBox('vbsOPass'); }, 0);
        return;
      }
      if (act === 'setupOrg') {
        // an organization found in VB Studio: its form, with its address (its name and sign-in to fill in)
        const org = String(key || '').replace(/\/$/, '').split('/').pop();
        v.formOrg = true; v.editId = ''; v.oName = org; v.oUrl = String(key || ''); v.oUser = ''; v.oPass = '';
        setTimeout(() => { fill('vbsOName', org); fill('vbsOUrl', String(key || '')); clearBox('vbsOUser'); clearBox('vbsOPass'); try { document.getElementById('vbsOUser').focus(); } catch (e) { /* not drawn */ } }, 0);
        v.result = { ok: true, text: 'Enter how you sign in to ' + org + ', then Save: its projects can then be added with one click.' };
        return;
      }
      // the filter: an organization (its projects); a project opened (its repositories and workspaces), closed
      const toFound = () => setTimeout(() => { try { const e = document.getElementById('vbsFound'); if (e && e.scrollIntoView) e.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (er) { /* not drawn */ } }, 30);
      const savedOf = (k) => (v.orgs || []).filter((o) => o.host + '/' + o.org === k)[0];
      if (act === 'filterOrg') { v.fOrg = String(key || ''); v.fProject = ''; const so = savedOf(v.fOrg); if (so) v.selOrg = so.id; return; }
      if (act === 'openProject') { const k = String(key || ''); v.fProject = k; v.fOrg = k.split('/').slice(0, 2).join('/'); const so = savedOf(v.fOrg); if (so) v.selOrg = so.id; toFound(); return; }
      if (act === 'closeProject') { v.fProject = ''; toFound(); return; }
      if (act === 'cancelOrg') { v.formOrg = false; v.editId = ''; v.oPass = ''; clearBox('vbsOPass'); return; }
      if (v.busy) return;
      v.busy = true; v.result = null;
      let pressed = null;
      try { const a = document.activeElement; pressed = a && a.closest ? a.closest('button') : null; if (pressed) pressed.classList.add('nx-btn--working'); } catch (e) { pressed = null; }
      try {
        if (act === 'saveOrg') {
          const r = await VC.saveOrg({ id: v.editId, name: v.oName, url: v.oUrl, user: v.oUser, password: v.oPass });
          v.oPass = ''; clearBox('vbsOPass');
          if (!r.ok) { v.result = { ok: false, text: r.body.error || 'Not saved.' }; return; }
          v.orgs = r.body.orgs; v.projects = r.body.projects; v.selOrg = r.body.org.id; v.formOrg = false; v.editId = '';
          v.result = { ok: true, text: 'Saved: ' + r.body.org.name + '. Now add a project by its Git address: that checks the sign-in too.' };
          return;
        }
        if (act === 'find') {
          const sel = (v.orgs || []).filter((x) => x.id === v.selOrg)[0];
          const url = v.formOrg && v.oUrl ? v.oUrl : sel ? sel.url : '';
          const r = await VC.find(url);
          if (!r.ok) { v.result = { ok: false, text: r.body.error || 'Could not open VB Studio.' }; return; }
          v.result = { ok: true, text: 'VB Studio is open in a window of Build.Rite (' + r.body.url + '). Sign in as usual, then open the organization\'s page, a project\'s Repositories and Workspaces: what it shows appears below.' };
          watch(v);
          return;
        }
        if (act === 'sync') {
          // Sync from VB Studio (API): no window; its steps shown live (read again every second or so while it runs)
          v.syncing = true; v.syncOpen = false;
          const poll = setInterval(async () => { const f = await VC.discovered(); if (f.ok && v.syncing) v.found = f.body; }, 1200);
          let r;
          try { r = await VC.sync(v.fOrg ? { orgKey: v.fOrg } : ''); } finally { clearInterval(poll); v.syncing = false; }
          if (r.body && Array.isArray(r.body.projects)) v.found = r.body;
          v.syncOpen = !r.ok; // what Sync did: shown open when something went wrong
          const s = await VC.state();
          if (s.ok) { v.orgs = s.body.orgs; v.projects = s.body.projects; }
          if (!r.ok) { v.result = { ok: false, text: r.body.error || 'Sync did not work.' }; return; }
          const c = r.body.counts || {};
          v.result = { ok: true, text: 'Synced from VB Studio (API, no window): ' + c.projects + ' project' + (c.projects === 1 ? '' : 's') + ', ' + c.repos + ' repositor' + (c.repos === 1 ? 'y' : 'ies') + ', ' + c.workspaces + ' workspace' + (c.workspaces === 1 ? '' : 's') + '.' };
          return;
        }
        if (act === 'findRepos' || act === 'syncProject') {
          // one project: its repositories (VB Studio's API, else the names VB Studio usually gives, checked with git), or
          // its repositories and workspaces again through the API
          const k = String(key || '').split('/');
          const ok = k.slice(0, 2).join('/'), pid = k.slice(2).join('/');
          const fp = ((v.found && v.found.projects) || []).filter((p) => p.host + '/' + p.org + '/' + p.project === String(key || ''))[0] || {};
          const r = act === 'findRepos' ? await VC.findRepos(ok, pid, fp.name || '') : await VC.sync({ orgKey: ok, project: pid });
          if (r.body && Array.isArray(r.body.projects)) v.found = r.body;
          if (!r.ok) { v.result = { ok: false, text: r.body.error || 'Not found.' }; return; }
          const np = ((v.found && v.found.projects) || []).filter((p) => p.host + '/' + p.org + '/' + p.project === String(key || ''))[0] || {};
          const nr = (np.repos || []).length;
          const nw = ((v.found && v.found.workspaces) || []).filter((w) => w.host + '/' + w.org + '/' + w.project === String(key || '')).length;
          v.result = act === 'findRepos'
            ? { ok: true, text: 'Found ' + (fp.name || pid) + '\'s repositor' + (nr === 1 ? 'y' : 'ies') + ': ' + (np.repos || []).map((x) => x.repo).join(', ') + (r.body.via === 'git' ? ' (checked with git: it exists).' : ' (from VB Studio\'s API).') + ' Add it to Build.Rite to work with it.' }
            : { ok: true, text: (fp.name || pid) + ' refreshed from VB Studio: ' + nr + ' repositor' + (nr === 1 ? 'y' : 'ies') + ', ' + nw + ' workspace' + (nw === 1 ? '' : 's') + '.' };
          return;
        }
        if (act === 'addFound') {
          const url = String(key || '');
          const m = /^https:\/\/([^/]+)\/([^/]+)\//.exec(url);
          const org = m ? (v.orgs || []).filter((x) => x.host === m[1] && x.org === m[2].toLowerCase())[0] : null;
          if (!org) { v.result = { ok: false, text: 'Set up its organization first (its sign-in).' }; return; }
          // its name as VB Studio shows it (the project found with this repository, or this guessed one)
          const fp = ((v.found && v.found.projects) || []).filter((p) => (p.repos || []).some((x) => x.url === url) || url.indexOf('/s/' + p.org + '_' + p.project + '/scm/') !== -1)[0];
          const r = await VC.addProject({ orgId: org.id, repoUrl: url, name: fp && fp.name ? fp.name : '' });
          if (r.body && r.body.state) { v.orgs = r.body.state.orgs; v.projects = r.body.state.projects; }
          if (!r.ok) { v.result = { ok: false, text: r.body.error || 'Not added.' }; return; }
          v.orgs = r.body.orgs; v.projects = r.body.projects; v.selOrg = org.id;
          const f = await VC.discovered();
          if (f.ok) v.found = f.body;
          v.result = { ok: true, text: 'Added and checked: ' + r.body.project.name + ' — signed in; ' + r.body.project.branches.length + ' branches, ' + r.body.project.jobs.length + ' build jobs.' };
          return;
        }
        if (act === 'diag') {
          const r = await VC.diagnostic();
          const ok = r.ok && await copy(r.body.text || '');
          v.result = ok ? { ok: true, text: 'Copied: the calls VB Studio\'s pages made, as paths and field names only (no names, no values, no password). Paste it to Claude to make the reading exact.' } : { ok: false, text: 'Could not copy here.' };
          return;
        }
        if (act === 'copyLog') {
          const lines = ((v.found && v.found.finder && v.found.finder.log) || []).map((l) => l.at + '  ' + l.text).join('\n');
          const ok = await copy(lines);
          v.result = ok ? { ok: true, text: 'Copied the VB Studio window\'s log (' + lines.split('\n').length + ' lines; addresses without their query, no password). Paste it to Claude.' } : { ok: false, text: 'Could not copy here.' };
          return;
        }
        if (act === 'clearFound') {
          const r = await VC.clearDiscovered();
          if (r.ok) v.found = r.body;
          v.result = { ok: true, text: 'Cleared what was found.' };
          return;
        }
        if (act === 'removeOrg') {
          const o = (v.orgs || []).filter((x) => x.id === key)[0];
          if (!o || !ask('Remove ' + o.name + ' and its projects from Build.Rite?\n\nNothing changes in VB Studio; its saved password is deleted from this PC.')) return;
          const r = await VC.removeOrg(key);
          if (r.ok) { v.orgs = r.body.orgs; v.projects = r.body.projects; v.selOrg = v.orgs.length ? v.orgs[0].id : ''; v.result = { ok: true, text: 'Removed: ' + o.name + '.' }; }
          else v.result = { ok: false, text: r.body.error || 'Not removed.' };
          return;
        }
        if (act === 'addProject') {
          if (!String(v.pRepo || '').trim()) { v.result = { ok: false, text: 'Paste the project\'s Git address (its Repositories tab → Clone, HTTPS).' }; return; }
          const r = await VC.addProject({ orgId: v.selOrg, repoUrl: v.pRepo, name: v.pName });
          if (r.body && r.body.state) { v.orgs = r.body.state.orgs; v.projects = r.body.state.projects; }
          if (!r.ok) { v.result = { ok: false, text: r.body.error || 'Not added.' }; return; }
          v.orgs = r.body.orgs; v.projects = r.body.projects; v.pRepo = ''; v.pName = ''; clearBox('vbsPRepo'); clearBox('vbsPName');
          const p = r.body.project;
          v.result = { ok: true, text: 'Added and checked: ' + p.name + ' — signed in; ' + p.branches.length + ' branch' + (p.branches.length === 1 ? '' : 'es') + ', ' + p.jobs.length + ' build job' + (p.jobs.length === 1 ? '' : 's') + '.' };
          return;
        }
        if (act === 'checkProject') {
          const r = await VC.checkProject(key);
          if (r.body && r.body.state) { v.orgs = r.body.state.orgs; v.projects = r.body.state.projects; }
          if (!r.ok) { v.result = { ok: false, text: r.body.error || 'Not checked.' }; return; }
          v.orgs = r.body.orgs; v.projects = r.body.projects;
          v.result = { ok: true, text: 'Checked: ' + r.body.project.name + ' — signed in; ' + r.body.project.branches.length + ' branches, ' + r.body.project.jobs.length + ' build jobs.' };
          return;
        }
        if (act === 'removeProject') {
          const p = (v.projects || []).filter((x) => x.id === key)[0];
          if (!p || !ask('Remove the project ' + p.name + ' from Build.Rite?\n\nNothing changes in VB Studio.')) return;
          const r = await VC.removeProject(key);
          if (r.ok) { v.orgs = r.body.orgs; v.projects = r.body.projects; v.result = { ok: true, text: 'Removed: ' + p.name + '.' }; }
          return;
        }
      } finally {
        try { if (pressed) pressed.classList.remove('nx-btn--working'); } catch (e) { /* redrawn */ }
        v.busy = false;
      }
    }
  }
  return actChain;
});
