define(['vb/action/actionChain', 'resources/js/shellBus', 'resources/js/vbsClient'], (ActionChain, bus, VC) => {
  'use strict';

  // Build.Rite's top bar: the working copy — the VB Studio project ▸ workspace whose repository is cloned on this PC and
  // where changes are made (desktop/lib/vbs.js work). 'load': read it (again when a project's tab changes it); 'open':
  // its project's tab, on that workspace — or, none yet, Set up your workspace (the wizard). Its menu: run its app, open its
  // project, set up another, stop using it (its folders kept), remove it from this PC (asked first: what would be lost
  // said). ▶ Run (beside it): its app, built from the working folder, in a window of its own.
  class workChain extends ActionChain {
    async run(context, { act }) {
      const v = context.$page.variables;
      if (act === 'load') {
        // a read that fails (the desktop app busy for a moment) keeps what was known — it does not look like no workspace
        const read = async () => { try { const r = await VC.work(); if (r.ok && r.body) v.work = r.body; } catch (e) { /* as it was */ } };
        bus.on('vbs-changed', 'shell', () => { read(); });
        try { window.addEventListener('focus', () => { read(); }); } catch (e) { /* no window */ } // back in front: read again
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
      // ▶ Run: your workspace's app, built from its working folder (when its code changed), in a window of its own; Run
      // again after more changes builds again and reloads that window
      if (act === 'run') {
        if (v.workRunning || !c) return;
        v.workRunning = true;
        try {
          bus.toast('▶ Building ' + wsName + '\'s app from its working folder (when its code changed) and opening it…', 'info');
          // what is in it: your working copy, and its changes since VB Studio (named), so you know what to look for
          const t = VC.runText(await VC.workRun(''));
          bus.toast(t.text, t.tone);
        } finally { v.workRunning = false; }
        return;
      }
      if (act === 'console') { bus.open({ navId: 'run-console' }); return; }
      if (act === 'switch') { bus.open({ record: 'vbs-setup', params: {} }); bus.emit('vbs-setup', { reset: true }); return; }
      if (act === 'stop') {
        const r = await VC.workStop();
        if (r.ok) { v.work = r.body; changed(); bus.toast('Stopped using ' + wsName + ': its folders are kept — set it up again to use it.', 'info'); }
        return;
      }
      if (act === 'remove') {
        const r = await VC.workRemove(c);
        if (r.body && r.body.cancelled) return;
        if (r.ok) { v.work = r.body; changed(); bus.toast(r.body.keptFolder ? 'Removed ' + wsName + ' from Build.Rite: its folder is kept at ' + r.body.keptFolder + '.' : 'Removed ' + wsName + ' from this PC.', 'info'); } else bus.toast(r.body.error || 'It could not be removed.', 'error');
        return;
      }
      if (c) bus.open({ record: 'vbs-project', params: { key: c.orgKey + '/' + c.project, name: c.projectName, ws: c.workspace } });
      else { bus.open({ record: 'vbs-setup', params: {} }); bus.emit('vbs-setup', { reset: true }); }
    }
  }
  return workChain;
});
