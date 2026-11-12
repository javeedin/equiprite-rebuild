define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/pagesClient',
  'resources/js/pageSheet',
  'resources/js/minutesClient',
  'resources/js/shellBus',
], (ActionChain, Actions, PC, PS, M, bus) => {
  'use strict';

  // The sheet's actions: build/refresh it, capture or upload screenshots (a page keeps several; the viewer shows one at a
  // time, full size), explain it with AI, map/unmap a Jira story, delete/restore the page, rescan the code, commit & push;
  // a count in the Overview scrolls to its part; a mapped story opens its AI analysis. Each change is committed and pushed to git
  // when "Commit & push each change" is ticked.
  const gitNote = (g) => (!g ? '' : g.ok ? (g.pushed ? ' Pushed to ' + g.upstream + '.' : g.nothing ? '' : ' Committed, not pushed.') : ' Git: ' + g.error + (g.hint ? ' ' + g.hint : ''));

  class actChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      const base = context.$application.path;
      if (!act) return;
      if (act === 'story') { if (key) bus.open({ record: 'jira-analysis', params: { key: key } }); return; }
      // the screenshot viewer: a native dialog (showModal: the browser's top layer, above everything; Esc closes it)
      const shots = (v.sheet && v.sheet.screenshots) || [];
      const dlg = () => { try { return document.getElementById('pgViewer'); } catch (e) { return null; } };
      if (act === 'view') {
        v.viewer = Math.max(0, Math.min(shots.length - 1, Number(key) || 0));
        setTimeout(() => { const d = dlg(); try { if (d && !d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); } } catch (e) { /* already open */ } }, 0);
        return;
      }
      if (act === 'unview') { const d = dlg(); try { if (d && d.open) d.close(); } catch (e) { /* closed */ } v.viewer = -1; return; }
      if (act === 'closed') { v.viewer = -1; return; } // Esc, or closed by the browser
      if (act === 'prev') { if (v.viewer > 0) v.viewer = v.viewer - 1; return; }
      if (act === 'next') { if (v.viewer < shots.length - 1) v.viewer = v.viewer + 1; return; }
      // a count in the Overview: its part of the sheet
      if (act === 'jump') { try { const el = document.getElementById(key); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { /* no DOM */ } return; }
      const refresh = async () => {
        const cat = await PC.catalog(base);
        v.pages = cat.body.pages;
        if (v.selId) { const r = await PC.sheet(base, v.selId); if (r.ok) { v.sheet = r.body.sheet; v.saved = !!r.body.saved; v.codeChanged = !!r.body.codeChanged; } }
        if (v.info.canWrite) v.git = (await PC.gitStatus()).body || v.git;
      };
      const done = async (r, okText) => {
        const b = r.body || {};
        v.result = b.ok ? { ok: !b.git || b.git.ok, text: (okText + gitNote(b.git)).trim() } : { ok: false, text: b.error || 'That did not work.' };
        await refresh();
      };
      v.busy = true;
      try {
        const id = v.selId;
        if (act === 'rescan') { v.progress = 'Reading every page of the project…'; const r = await PC.rescan(v.commit); await done(r, 'The page list is up to date: ' + ((r.body && r.body.pages) || 0) + ' pages.'); return; }
        if (act === 'push') { const r = await PC.gitSave('Application pages: update'); v.result = r.body.ok ? { ok: true, text: r.body.nothing ? 'Nothing to commit or push.' : 'Saved to git' + (r.body.pushed ? ', pushed to ' + r.body.upstream : '') + '.' } : { ok: false, text: (r.body.error || 'git failed.') + (r.body.hint ? ' ' + r.body.hint : '') }; await refresh(); return; }
        if (!id) return;
        if (act === 'build') { v.progress = 'Reading the page\'s code…'; await done(await PC.build(id, v.commit), 'The technical sheet is saved.'); return; }
        if (act === 'capture') { v.progress = 'Opening the page in a hidden window and capturing it (up to 30 s)…'; await done(await PC.capture(id, v.commit), 'Screenshot captured.'); return; }
        if (act === 'upload') {
          // one or several images, each added to the page's screenshots (one commit at the end)
          let files = [];
          try { const el = document.getElementById('pgShotFile'); files = el && el.files ? Array.prototype.slice.call(el.files) : []; if (el) setTimeout(() => { el.value = ''; }, 0); } catch (e) { /* no DOM */ }
          if (!files.length) return;
          const big = files.filter((f) => f.size > 8 * 1024 * 1024);
          if (big.length) { v.result = { ok: false, text: big.map((f) => f.name).join(', ') + ': larger than 8 MB.' }; return; }
          let r = null;
          for (let i = 0; i < files.length; i++) {
            v.progress = 'Saving ' + files[i].name + (files.length > 1 ? ' (' + (i + 1) + ' of ' + files.length + ')' : '') + '…';
            r = await PC.upload(id, await PC.readFile(files[i]), files[i].type, v.commit && i === files.length - 1, files[i].name.replace(/\.[^.]+$/, ''));
            if (!(r.body && r.body.ok)) break;
          }
          await done(r, files.length > 1 ? files.length + ' screenshots saved.' : 'Screenshot saved.');
          return;
        }
        if (act === 'unshot') {
          const s1 = shots[v.viewer];
          if (!s1) return;
          let yes = true;
          try { yes = window.confirm('Delete screenshot ' + (v.viewer + 1) + ' of this page?'); } catch (e) { /* no DOM */ }
          if (!yes) return;
          const r = await PC.removeShot(id, s1.id, v.commit);
          await done(r, 'Screenshot deleted.');
          v.viewer = ((v.sheet && v.sheet.screenshots) || []).length ? Math.min(v.viewer, v.sheet.screenshots.length - 1) : -1;
          if (v.viewer < 0) { const d = dlg(); try { if (d && d.open) d.close(); } catch (e) { /* closed */ } }
          return;
        }
        if (act === 'delete') {
          const n = (v.sheet && v.sheet.stories ? v.sheet.stories.length : 0), m = shots.length;
          let yes = true;
          try { yes = window.confirm('Delete "' + (v.sheet ? v.sheet.facts.label : id) + '" from the catalog?\n\nIts technical sheet, ' + m + ' screenshot(s) and ' + n + ' story mapping(s) are removed, and it is hidden from the lists (Show deleted → Restore brings it back).'); } catch (e) { /* no DOM */ }
          if (!yes) return;
          v.progress = 'Deleting…';
          const r = await PC.remove(id, v.commit);
          await done(r, 'Deleted from the catalog.');
          v.deleted = true; v.viewer = -1;
          return;
        }
        if (act === 'restore') { const r = await PC.restore(id, v.commit); await done(r, 'Restored: it is back in the lists.'); v.deleted = false; return; }
        if (act === 'explain') {
          if (!v.aiReady) { try { const a = await M.aiSettings(); v.aiReady = !!(a.ok && a.body && a.body.active); } catch (e) { /* keep */ } }
          if (!v.aiReady) { v.result = { ok: false, text: 'Set up AI first (Standup minutes → Set up AI).' }; return; }
          v.progress = 'Asking the AI to explain the page from its code facts…';
          const p = PS.prompt(v.sheet.facts);
          const r = await M.aiChat(p.system, p.user);
          if (!(r.ok && r.body && r.body.ok && r.body.text)) { v.result = { ok: false, text: (r.body && r.body.error) || 'The AI did not answer.' }; return; }
          await done(await PC.saveAi(id, r.body.text, r.body.provider || 'AI', v.commit), 'The AI explanation is saved with the sheet.');
          return;
        }
        if (act === 'map') {
          const k = String(v.mapKey || '').trim().toUpperCase();
          if (!/^[A-Z][A-Z0-9]*-\d+$/.test(k)) { v.result = { ok: false, text: 'Give a Jira story key, like EQP-123.' }; return; }
          v.progress = 'Mapping ' + k + '…';
          const r = await PC.assign(id, k, v.commit);
          v.mapKey = '';
          try { const el = document.getElementById('pgMapKey'); if (el) el.value = ''; } catch (e) { /* no DOM */ }
          await done(r, k + ' is mapped to this page' + (r.body && r.body.built ? ' (its technical sheet was built).' : ' (its sheet was already there).'));
          return;
        }
        if (act === 'unmap' && key) { await done(await PC.unassign(id, key, v.commit), key + ' is no longer mapped to this page.'); }
      } finally {
        v.progress = '';
        v.busy = false;
      }
    }
  }
  return actChain;
});
