define(['vb/action/actionChain', 'resources/js/vbsClient'], (ActionChain, VC) => {
  'use strict';

  // Setup → Organizations & projects: an organization chosen, added, edited (its sign-in saved encrypted on this PC; the
  // password field emptied at once), removed; a project added by its Git address (checked: the sign-in, its branches, its
  // build jobs), checked again, removed.
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
