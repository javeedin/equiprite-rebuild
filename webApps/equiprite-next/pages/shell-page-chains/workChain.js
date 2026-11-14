define(['vb/action/actionChain', 'resources/js/shellBus', 'resources/js/vbsClient'], (ActionChain, bus, VC) => {
  'use strict';

  // Build.Rite's top bar: the working copy — the VB Studio project ▸ workspace whose repository is cloned on this PC and
  // where changes are made (desktop/lib/vbs.js work). 'load': read it (again when a project's tab changes it); 'open':
  // its project's tab, on that workspace — or Organizations & projects, to choose one.
  class workChain extends ActionChain {
    async run(context, { act }) {
      const v = context.$page.variables;
      if (act === 'load') {
        const read = async () => { const r = await VC.work(); v.work = r.ok ? r.body : null; };
        bus.on('vbs-changed', 'shell', () => { read(); });
        await read();
        return;
      }
      const c = v.work && v.work.current;
      if (c) bus.open({ record: 'vbs-project', params: { key: c.orgKey + '/' + c.project, name: c.projectName, ws: c.workspace } });
      else bus.open({ navId: 'projects' });
    }
  }
  return workChain;
});
