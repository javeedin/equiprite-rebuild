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
      const p = V.project(v.found, v.key);
      if (p && !p.workspaces.length && !v.refresh) await Actions.callChain(context, { chain: 'actChain', params: { act: 'refresh', key: '' } });
    }
  }
  return loadChain;
});
