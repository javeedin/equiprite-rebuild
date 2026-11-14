define(['vb/action/actionChain', 'resources/js/vbsClient', 'resources/js/vbsView', 'resources/js/shellBus'], (ActionChain, VC, V, bus) => {
  'use strict';

  // The wizard's steps: a project chosen (its workspaces read from VB Studio when none were), a workspace; the folder
  // (typed, or the desktop app's folder dialog); the preview (workPlan: what is made, what is in the way); Set workspace &
  // working folder (workUse: main cloned, working made, made current — the top bar shows it); then start working.
  const fill = (id, val) => { try { const e = document.getElementById(id); if (e) e.value = val; } catch (er) { /* not drawn */ } };
  class actChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      const p = V.project(v.found, v.selProject);
      const w = p && p.workspaces.filter((x) => x.key === v.selWs)[0];
      const parts = String(v.selProject || '').split('/');
      const plan = () => ({ orgKey: parts.slice(0, 2).join('/'), project: parts.slice(2).join('/'), projectName: p ? p.name : '', workspace: w ? w.name : '', repo: w ? w.repo : '', branch: w ? w.branchName : '', folder: v.folder });
      if (act === 'org') { v.fOrg = String(key || ''); return; }
      if (act === 'openProjects') { bus.open({ navId: 'projects' }); return; }
      if (act === 'ws') { v.selWs = String(key || ''); v.plan = null; return; }
      if (act === 'back') { v.result = null; v.step = Math.max(1, v.step - (v.step === 4 ? 2 : 1)); return; }
      if (act === 'start') {
        const c = v.done && v.done.copy;
        if (c) bus.open({ record: 'vbs-project', params: { key: c.orgKey + '/' + c.project, name: c.projectName, ws: c.workspace } });
        return;
      }
      if (v.busy) return;
      v.busy = true;
      try {
        if (act === 'project') {
          v.selProject = String(key || ''); v.selWs = ''; v.plan = null; v.result = null;
          const np = V.project(v.found, v.selProject);
          if (np && !np.workspaces.length) {
            // none read yet: read them from VB Studio now (that project only)
            const k = v.selProject.split('/');
            const r = await VC.sync({ orgKey: k.slice(0, 2).join('/'), project: k.slice(2).join('/') });
            if (r.body && Array.isArray(r.body.projects)) v.found = r.body;
            if (!r.ok) v.result = { ok: false, text: 'Its workspaces could not be read: ' + ((r.body && r.body.error) || 'VB Studio did not answer.') };
          }
          return;
        }
        if (act === 'browse') {
          const r = await VC.pickFolder(v.folder);
          if (!r.ok) { v.result = { ok: false, text: r.body.error || 'Could not open the folder dialog: type the folder.' }; return; }
          if (r.body.folder) { v.folder = r.body.folder; v.plan = null; fill('vbsuFolder', r.body.folder); }
          return;
        }
        if (act === 'next') {
          v.result = null;
          if (v.step === 1) { v.step = 2; setTimeout(() => fill('vbsuFolder', v.folder), 0); return; }
          if (v.step === 2) {
            const r = await VC.workPlan(plan());
            v.plan = r.body;
            if (!r.ok) { v.result = { ok: false, text: r.body.error || 'That folder cannot be used.' }; return; }
            v.step = 3;
          }
          return;
        }
        if (act === 'set') {
          v.step = 4; v.done = null; v.result = null;
          v.busyText = v.plan && v.plan.reuse ? 'Using your copy already on this PC…' : 'Copying ' + (w ? w.branchName : 'the branch') + ' from VB Studio into main, then making working… (a big repository takes a minute)';
          const r = await VC.workUse(plan());
          v.done = Object.assign({}, r.body, { ok: !!r.ok });
          v.result = r.ok ? { ok: true, text: r.body.reused ? 'Your workspace is set (its copy on this PC used again).' : 'Your workspace is set: main and working made.' } : { ok: false, text: r.body.error || 'It could not be set up.' };
          if (r.ok) bus.emit('vbs-changed', { work: true });
          return;
        }
        if (act === 'openFolder') {
          const c = v.done && v.done.copy;
          const r = c ? await VC.workOpen(c.id, 'base') : null;
          if (r && !r.ok) v.result = { ok: false, text: r.body.error || 'Could not open it.' };
        }
      } finally {
        v.busy = false;
      }
    }
  }
  return actChain;
});
