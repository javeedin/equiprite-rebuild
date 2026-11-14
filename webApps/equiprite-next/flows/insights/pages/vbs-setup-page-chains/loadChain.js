define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/vbsClient', 'resources/js/vbsView', 'resources/js/shellBus'], (ActionChain, Actions, VC, V, bus) => {
  'use strict';

  // The wizard opened: what Build.Rite knows from VB Studio (projects, workspaces), the folder last used (or Build.Rite's
  // own); opened on a workspace (a project's tab): straight to the folder step. Opened again on another: the same.
  class loadChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.loading = true;
      try {
        const [f, w] = await Promise.all([VC.discovered(), VC.work()]);
        if (f.ok) v.found = f.body;
        if (w.ok) { v.work = w.body; const c = w.body.current; if (!v.folder) v.folder = (c && c.folder) || w.body.defaultFolder || ''; }
      } finally { v.loading = false; }
      const pick = (key, ws) => {
        const p = V.project(v.found, key);
        if (!p) return;
        v.selProject = key; v.fOrg = '';
        const w0 = ws ? p.workspaces.filter((x) => x.name === ws)[0] : null;
        if (w0) { v.selWs = w0.key; v.step = 2; v.plan = null; v.done = null; v.result = null; }
        else { v.selWs = ''; v.step = 1; }
      };
      if (v.key) pick(v.key, v.ws);
      // opened again: on a workspace (a project's tab), or from the start (the top bar: set up another)
      bus.on('vbs-setup', 'vbs-setup', async (d) => {
        if (d && d.key) { pick(d.key, d.ws); return; }
        if (d && d.reset && !v.busy) {
          v.step = 1; v.selWs = ''; v.plan = null; v.done = null; v.result = null; v.prog = null;
          const [f, w] = await Promise.all([VC.discovered(), VC.work()]);
          if (f.ok) v.found = f.body;
          if (w.ok) v.work = w.body;
        }
      });
      void Actions;
    }
  }
  return loadChain;
});
