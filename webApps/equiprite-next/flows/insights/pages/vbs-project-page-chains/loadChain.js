define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/vbsClient', 'resources/js/vbsView'], (ActionChain, Actions, VC, V) => {
  'use strict';

  // A project's tab opened: what Build.Rite has read from VB Studio, shown at once; a project with no workspace read yet
  // is read from VB Studio straight away (Refresh workspaces).
  class loadChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      v.loading = true;
      try {
        const f = await VC.discovered();
        if (f.ok) v.found = f.body;
        else v.result = { ok: false, text: (f.body && f.body.error) || 'Could not read what Build.Rite knows from VB Studio.' };
      } finally { v.loading = false; }
      // the working copy: the current one; checked (on this PC) when it is in this project
      try {
        const w = await VC.work();
        if (w.ok) {
          v.work = w.body;
          const c = w.body.current;
          if (c && c.orgKey + '/' + c.project === v.key) { const st = await VC.workStatus(c.id, false); v.workSt = st.body; }
        }
      } catch (e) { /* no working copy */ }
      const p = V.project(v.found, v.key);
      // opened on one workspace (the top bar's working copy): shown at once
      if (p && v.ws && !v.wsSel) { const w0 = p.workspaces.filter((x) => x.name === v.ws)[0]; if (w0) await Actions.callChain(context, { chain: 'actChain', params: { act: 'selectWs', key: w0.key } }); }
      if (p && !p.workspaces.length && !v.refresh) await Actions.callChain(context, { chain: 'actChain', params: { act: 'refresh', key: '' } });
    }
  }
  return loadChain;
});
