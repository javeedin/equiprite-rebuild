define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/pagesClient', 'resources/js/shellBus', 'resources/js/pageMap'], (ActionChain, Actions, PC, bus, PM) => {
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
      // the API tester: its calls' last runs and its reports (not waited for: the sheet shows at once)
      v.apiLast = {}; v.apiReports = []; v.apiCheck = null;
      Actions.callChain(context, { chain: 'apiChain', params: { act: 'load', key: '' } });
      if (v.view === 'map' || v.view === 'global') PM.redraw(); // picked on a map: the lines for the new page
      if (v.view === 'fix') await Actions.callChain(context, { chain: 'fixChain', params: { act: 'open', key: '' } }); // its fixes
      if (v.view === 'code') await Actions.callChain(context, { chain: 'codeChain', params: { act: 'open', key: '' } }); // its files
      try { setTimeout(() => { const row = document.querySelector('#pgRows [data-id="' + pid.replace(/"/g, '') + '"]'); if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' }); }, 40); } catch (e) { /* no DOM */ }
      try { setTimeout(() => { const el = document.getElementById('pgSheet'); if (el && el.scrollIntoView && window.innerWidth < 1100) el.scrollIntoView({ behavior: 'smooth' }); }, 30); } catch (e) { /* no DOM */ }
    }
  }
  return selectChain;
});
