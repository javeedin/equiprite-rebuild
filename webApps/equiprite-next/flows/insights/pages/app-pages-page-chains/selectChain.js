define(['vb/action/actionChain', 'resources/js/pagesClient', 'resources/js/shellBus'], (ActionChain, PC, bus) => {
  'use strict';

  // A page picked: its sheet (the saved one, or — before it is built — the facts read from its code now).
  class selectChain extends ActionChain {
    async run(context, { id }) {
      const v = context.$page.variables;
      const pid = String(id || '');
      if (!pid) return;
      v.selId = pid; v.result = null; v.progress = ''; v.viewer = -1;
      try { const d = document.getElementById('pgViewer'); if (d && d.open) d.close(); } catch (e) { /* no DOM */ }
      const r = await PC.sheet(context.$application.path, pid);
      if (v.selId !== pid) return; // another was picked meanwhile
      if (!r.ok) { v.sheet = null; v.result = { ok: false, text: (r.body && r.body.error) || 'Could not read this page.' }; return; }
      v.sheet = r.body.sheet; v.saved = !!r.body.saved; v.codeChanged = !!r.body.codeChanged;
      v.deleted = !!r.body.deleted || (v.pages || []).some((p) => p.id === pid && p.deleted);
      try { setTimeout(() => { const el = document.getElementById('pgSheet'); if (el && el.scrollIntoView && window.innerWidth < 1100) el.scrollIntoView({ behavior: 'smooth' }); }, 30); } catch (e) { /* no DOM */ }
    }
  }
  return selectChain;
});
