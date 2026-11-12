define([
  'vb/action/actionChain',
  'resources/js/pagesClient',
  'resources/js/shellBus',
], (ActionChain, PC, bus) => {
  'use strict';

  // A story's Application pages (resources/js/pagesClient.js; the catalog is in git): load the catalog, open/close the
  // Assign page picker and search it, assign a page (its technical sheet is built when it has none, else only the story
  // number is added), unmap one, and open a page's technical sheet (Application pages, on that page).
  class pagesChain extends ActionChain {
    async run(context, { act, id }) {
      const v = context.$page.variables;
      const base = context.$application.path;
      const key = String(v.selKey || (v.story && v.story.key) || '').toUpperCase();
      const reload = async () => { const c = await PC.catalog(base); if (c.ok || !(v.pgCat || []).length) v.pgCat = c.body.pages; };
      if (act === 'load') {
        if (!v.pgInfo || !v.pgInfo.available) { try { v.pgInfo = await PC.info(); } catch (e) { /* read only */ } }
        await reload();
        return;
      }
      if (act === 'q') { v.pgQ = String(id || ''); return; }
      if (act === 'close') { v.pgPick = false; v.pgQ = ''; return; }
      if (act === 'pick') {
        v.pgPick = !v.pgPick; v.pgQ = '';
        if (v.pgPick) {
          if (!(v.pgCat || []).length) await reload();
          try { setTimeout(() => { const el = Array.prototype.filter.call(document.querySelectorAll('.nx-sp-q'), (e) => e.offsetParent !== null)[0]; if (el) el.focus(); }, 30); } catch (e) { /* no DOM */ }
        }
        return;
      }
      if (act === 'open' && id) {
        if (typeof v.selKey === 'string' && v.selKey) v.selKey = ''; // close the (modal) drawer, so the new tab is usable
        bus.focus('app-pages', { id: String(id), story: key });
        return;
      }
      if (!key || !id) return;
      if (act === 'assign') {
        v.pgPick = false; v.pgQ = ''; v.pgBusy = true; v.pgBusyText = 'Mapping ' + key + ' to the page (building its technical sheet if it has none)…';
        try {
          const r = await PC.assign(String(id), key, true);
          const b = r.body || {};
          if (!b.ok) { bus.toast(b.error || 'Could not assign the page.', 'error'); return; }
          bus.toast(key + ' → ' + ((b.sheet && b.sheet.facts && b.sheet.facts.label) || id) + (b.built ? ': its technical sheet was built' : ': its sheet was already there') + (b.git && b.git.pushed ? ', pushed to git.' : b.git && !b.git.ok ? '. Git: ' + b.git.error : '.'), b.git && !b.git.ok ? 'error' : 'info');
          await reload();
        } finally { v.pgBusy = false; v.pgBusyText = ''; }
        return;
      }
      if (act === 'unmap') {
        let yes = true;
        try { yes = window.confirm('Unmap this page from ' + key + '?'); } catch (e) { /* no DOM */ }
        if (!yes) return;
        v.pgBusy = true; v.pgBusyText = 'Unmapping…';
        try {
          const r = await PC.unassign(String(id), key, true);
          if (!(r.body && r.body.ok)) bus.toast((r.body && r.body.error) || 'Could not unmap the page.', 'error');
          await reload();
        } finally { v.pgBusy = false; v.pgBusyText = ''; }
      }
    }
  }
  return pagesChain;
});
