define(['vb/action/actionChain', 'resources/js/vbsClient', 'resources/js/runConsoleView', 'resources/js/shellBus'], (ActionChain, VC, RC, bus) => {
  'use strict';

  // The Run console's buttons and commands: a button is a command (data-key: run, build, reload…); Run command (or Enter)
  // sends what is typed; the filter chips; Clear. Each command goes to the desktop app (desktop/lib/runConsole.js) and its
  // answer appears in the log as it is read.
  class actChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      const input = () => { try { return document.getElementById('rcCmd'); } catch (e) { return null; } };
      if (act === 'filter') { v.filter = String(key || ''); return; }
      // Run as: a role chosen or not; Apply (the app's window reloads); back to the EquipRite sign-in
      if (act === 'role') { const r = String(key || ''); v.asRoles = (v.asRoles || []).indexOf(r) !== -1 ? v.asRoles.filter((x) => x !== r) : (v.asRoles || []).concat([r]); v.asTouched = true; return; }
      if (act === 'asApply' || act === 'asClear') {
        const user = act === 'asClear' ? '' : String(v.asUser || '').trim();
        const r = await VC.consoleRunAs(user, act === 'asClear' ? [] : v.asRoles);
        const b = r.body || {};
        bus.toast(b.text || (r.ok ? 'Done.' : 'It could not be changed.'), b.ok ? 'success' : 'error');
        if (b.ok) { v.status = b; v.asTouched = false; if (act === 'asClear') { v.asUser = ''; v.asRoles = []; try { const el = document.getElementById('rcAsUser'); if (el) el.value = ''; } catch (e) { /* no DOM */ } } }
        RC.now();
        return;
      }
      if (act === 'clear') { RC.clear(); await VC.consoleClear(); return; }
      let text = act === 'go' ? String((input() && input().value) || key || '').trim() : String(key || '').trim();
      if (act !== 'go' && act !== 'cmd') return;
      if (!text) return;
      if (act === 'go') { const el = input(); if (el) el.value = ''; }
      v.hist = (v.hist || []).filter((h) => h !== text).concat([text]).slice(-50);
      v.histAt = -1;
      if (/^(clear|cls)$/i.test(text)) { RC.clear(); await VC.consoleClear(); return; }
      if (v.busy) return;
      v.busy = true;
      v.busyText = text;
      try {
        RC.now();
        const r = await VC.consoleCmd(text);
        // its answer is in the log; a toast only when it did not get there at all
        if (!r.ok && !(r.body && (r.body.text || r.body.lines))) bus.toast((r.body && r.body.error) || 'The command did not reach the desktop app.', 'error');
        RC.now();
        const s = await VC.consoleStatus();
        if (s.ok && s.body && s.body.ok !== false) v.status = s.body;
      } finally {
        v.busy = false;
        v.busyText = '';
      }
    }
  }
  return actChain;
});
