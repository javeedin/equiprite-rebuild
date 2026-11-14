define(['vb/action/actionChain', 'resources/js/shellBus', 'resources/js/vbsClient'], (ActionChain, bus, VC) => {
  'use strict';

  // Build.Rite's top bar: the working copy — the VB Studio project ▸ workspace whose repository is cloned on this PC and
  // where changes are made (desktop/lib/vbs.js work). 'load': read it (again when a project's tab changes it); 'open':
  // its project's tab, on that workspace — or, none yet, Set up your workspace (the wizard). Its menu: open its project, set
  // up another, stop using it (its folders kept), remove it from this PC (asked first: what would be lost said).
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
      const wsName = c ? String(c.workspace) : ''; // read now: v.work is replaced below
      const changed = () => bus.emit('vbs-changed', { work: true, switched: true });
      if (act === 'menu') {
        v.workMenu = !v.workMenu;
        if (v.workMenu) {
          // closed by a click outside it, or Escape
          const close = (e) => {
            if (e.type === 'keydown' && e.key !== 'Escape') return;
            if (e.type === 'mousedown') { const w = document.getElementById('nxWorkWrap'); if (w && w.contains(e.target)) return; }
            v.workMenu = false;
            document.removeEventListener('mousedown', close, true);
            document.removeEventListener('keydown', close, true);
          };
          setTimeout(() => { document.addEventListener('mousedown', close, true); document.addEventListener('keydown', close, true); }, 0);
        }
        return;
      }
      v.workMenu = false;
      if (act === 'switch') { bus.open({ record: 'vbs-setup', params: {} }); bus.emit('vbs-setup', { reset: true }); return; }
      if (act === 'stop') {
        const r = await VC.workStop();
        if (r.ok) { v.work = r.body; changed(); bus.toast('Stopped using ' + wsName + ': its folders are kept — set it up again to use it.', 'info'); }
        return;
      }
      if (act === 'remove') {
        const r = await VC.workRemove(c);
        if (r.body && r.body.cancelled) return;
        if (r.ok) { v.work = r.body; changed(); bus.toast('Removed ' + wsName + ' from this PC.', 'info'); } else bus.toast(r.body.error || 'It could not be removed.', 'error');
        return;
      }
      if (c) bus.open({ record: 'vbs-project', params: { key: c.orgKey + '/' + c.project, name: c.projectName, ws: c.workspace } });
      else { bus.open({ record: 'vbs-setup', params: {} }); bus.emit('vbs-setup', { reset: true }); }
    }
  }
  return workChain;
});
