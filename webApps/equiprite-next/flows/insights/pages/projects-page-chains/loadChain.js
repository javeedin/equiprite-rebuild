define(['vb/action/actionChain', 'resources/js/vbsClient'], (ActionChain, VC) => {
  'use strict';

  // Setup → Organizations & projects opened (or Refresh): the organizations and projects kept on this PC.
  class loadChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
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
        // the filter kept while its organization and project are still there
        if (v.fOrg && !(f.body.orgs || []).some((o) => o.host + '/' + o.org === v.fOrg) && !v.orgs.some((o) => o.host + '/' + o.org === v.fOrg)) { v.fOrg = ''; v.fProject = ''; }
        if (v.fProject && !(f.body.projects || []).some((p) => p.host + '/' + p.org + '/' + p.project === v.fProject)) v.fProject = '';
      }
    }
  }
  return loadChain;
});
