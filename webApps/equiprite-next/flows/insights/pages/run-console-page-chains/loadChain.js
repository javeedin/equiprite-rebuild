define(['vb/action/actionChain', 'resources/js/vbsClient', 'resources/js/runConsoleView'], (ActionChain, VC, RC) => {
  'use strict';

  // Opening the Run console: its log read as it grows (every 0.8 s: only the new lines), and who the app runs as, the
  // workspace, its build and its window read now and every few seconds.
  class loadChain extends ActionChain {
    async run(context) {
      const v = context.$page.variables;
      const status = async () => {
        try {
          const r = await VC.consoleStatus();
          if (!(r.ok && r.body && r.body.ok !== false)) return;
          v.status = r.body;
          // Run as, as kept — unless being edited here
          if (!v.asTouched && r.body.runAs) { v.asUser = r.body.runAs.user || ''; v.asRoles = r.body.runAs.roles || []; }
        } catch (e) { /* next time */ }
      };
      let n = 0;
      RC.start({ mount: 'rcLog', fetch: VC.consoleLines, every: 800, onRead: () => { if (++n % 4 === 0) status(); } });
      await status();
      try { setTimeout(() => { const el = document.getElementById('rcCmd'); if (el) el.focus(); }, 300); } catch (e) { /* no DOM */ }
    }
  }
  return loadChain;
});
