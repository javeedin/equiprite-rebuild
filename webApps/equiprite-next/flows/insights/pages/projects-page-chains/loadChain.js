define(['vb/action/actionChain', 'resources/js/vbsClient', 'resources/js/shellBus'], (ActionChain, VC, bus) => {
  'use strict';

  // Setup → Organizations & projects opened (or Refresh): the organizations and projects kept on this PC.
  class loadChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      // a project's tab added a repository or read its workspaces: this list read again
      bus.on('vbs-changed', 'projects', async () => {
        const s = await VC.state();
        if (s.ok) { v.orgs = s.body.orgs || []; v.projects = s.body.projects || []; }
        const d = await VC.discovered();
        if (d.ok) v.found = d.body;
      });
      const r = await VC.state();
      v.checked = true;
      if (!r.ok) { v.available = !/desktop app|Not in a browser|did not answer/.test(String((r.body && r.body.error) || '')) ? true : false; if (v.available) v.result = { ok: false, text: (r.body && r.body.error) || 'Could not read them.' }; return; }
      v.available = true;
      v.orgs = r.body.orgs || [];
      v.projects = r.body.projects || [];
      if (!v.orgs.some((o) => o.id === v.selOrg)) v.selOrg = v.orgs.length ? v.orgs[0].id : '';
      if (!v.orgs.length) v.formOrg = true;
      const f = await VC.discovered();
      if (f.ok) {
        v.found = f.body;
        // the filter kept while its organization is still there
        if (v.fOrg && !(f.body.orgs || []).some((o) => o.host + '/' + o.org === v.fOrg) && !v.orgs.some((o) => o.host + '/' + o.org === v.fOrg)) v.fOrg = '';
      }
    }
  }
  return loadChain;
});
