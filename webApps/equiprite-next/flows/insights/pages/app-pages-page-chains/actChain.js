define([
  'vb/action/actionChain',
  'vb/action/actions',
  'resources/js/pagesClient',
  'resources/js/pageSheet',
  'resources/js/minutesClient',
  'resources/js/shellBus',
], (ActionChain, Actions, PC, PS, M, bus) => {
  'use strict';

  // The sheet's actions: build/refresh it, capture or upload its screenshot, explain it with AI, map/unmap a Jira story,
  // rescan the code, commit & push; and a mapped story opens its AI analysis. Each change is committed and pushed to git
  // when "Commit & push each change" is ticked.
  const gitNote = (g) => (!g ? '' : g.ok ? (g.pushed ? ' Pushed to ' + g.upstream + '.' : g.nothing ? '' : ' Committed, not pushed.') : ' Git: ' + g.error + (g.hint ? ' ' + g.hint : ''));

  class actChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      const base = context.$application.path;
      if (!act) return;
      if (act === 'story') { if (key) bus.open({ record: 'jira-analysis', params: { key: key } }); return; }
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
          let f = null;
          try { const el = document.getElementById('pgShotFile'); f = el && el.files && el.files[0]; if (el) setTimeout(() => { el.value = ''; }, 0); } catch (e) { /* no DOM */ }
          if (!f) return;
          if (f.size > 8 * 1024 * 1024) { v.result = { ok: false, text: 'The image is larger than 8 MB.' }; return; }
          v.progress = 'Saving ' + f.name + '…';
          await done(await PC.upload(id, await PC.readFile(f), f.type, v.commit), 'Screenshot saved.');
          return;
        }
        if (act === 'explain') {
          if (!v.aiReady) { try { const a = await M.aiSettings(); v.aiReady = !!(a.ok && a.body && a.body.active); } catch (e) { /* keep */ } }
          if (!v.aiReady) { v.result = { ok: false, text: 'Set up AI first (Standup minutes → Set up AI).' }; return; }
          v.progress = 'Asking the AI to explain the page from its code facts…';
          const p = PS.prompt(v.sheet.facts);
          const r = await M.aiChat(p.system, p.user);
          if (!(r.ok && r.body && r.body.ok && r.body.text)) { v.result = { ok: false, text: (r.body && r.body.error) || 'The AI did not answer.' }; return; }
          v.tab = 'overview';
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
