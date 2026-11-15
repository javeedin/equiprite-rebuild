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
      if (act === 'scope') { v.appF = bus.scope() || 'all'; return; } // the build in scope changed in the top bar
      // the screenshot viewer: a native dialog (showModal: the browser's top layer, above everything; Esc closes it)
      const shots = (v.sheet && v.sheet.screenshots) || [];
      const dlg = () => { try { return document.getElementById('pgViewer'); } catch (e) { return null; } };
      // the screenshot just added: its thumbnail flies in (for a moment)
      const arrived = (sid) => { v.shotNew = sid; setTimeout(() => { if (v.shotNew === sid) v.shotNew = ''; }, 2600); };
      if (act === 'view') {
        v.viewer = Math.max(0, Math.min(shots.length - 1, Number(key) || 0));
        setTimeout(() => { const d = dlg(); try { if (d && !d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); } } catch (e) { /* already open */ } }, 0);
        return;
      }
      if (act === 'setupWs') { bus.open({ record: 'vbs-setup', params: {} }); bus.emit('vbs-setup', { reset: true }); return; }
      if (act === 'copyPath') {
        // the working folder's full path, copied
        const t = String((v.codeFrom && v.codeFrom.root) || '');
        let ok = false;
        try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(t); ok = true; } } catch (e) { ok = false; }
        v.result = ok ? { ok: true, text: 'Copied: ' + t } : { ok: false, text: 'Could not copy here: ' + t };
        return;
      }
      if (act === 'unview') { const d = dlg(); try { if (d && d.open) d.close(); } catch (e) { /* closed */ } v.viewer = -1; return; }
      if (act === 'closed') { v.viewer = -1; return; } // Esc, or closed by the browser
      if (act === 'prev') { if (v.viewer > 0) v.viewer = v.viewer - 1; return; }
      if (act === 'next') { if (v.viewer < shots.length - 1) v.viewer = v.viewer + 1; return; }
      // a count in the Overview: its part of the sheet
      // a count in the Overview: to its part — smoothly, then once more when the scroll is over, in case the sheet above it
      // changed meanwhile (a progress line gone, a result shown), so it lands where it should
      if (act === 'jump') {
        const go = (smooth) => { try { const el = document.getElementById(key); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }); } catch (e) { /* no DOM */ } };
        go(true);
        setTimeout(() => go(false), 650);
        return;
      }
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
      v.busyAct = act;
      try {
        const id = v.selId;
        if (act === 'rescan') { v.progress = 'Reading every page of the project…'; const r = await PC.rescan(v.commit); await done(r, 'The page list is up to date: ' + ((r.body && r.body.pages) || 0) + ' pages.'); return; }
        if (act === 'push') { const r = await PC.gitSave('Application pages: update'); v.result = r.body.ok ? { ok: true, text: r.body.nothing ? 'Nothing to commit or push.' : 'Saved to git' + (r.body.pushed ? ', pushed to ' + r.body.upstream : '') + '.' } : { ok: false, text: (r.body.error || 'git failed.') + (r.body.hint ? ' ' + r.body.hint : '') }; await refresh(); return; }
        if (!id) return;
        if (act === 'build') {
          const list = [
            { label: 'Read the page\'s code', detail: 'its HTML, JSON, JavaScript and action chains', state: 'active' },
            { label: 'Work out its facts and save the sheet', detail: 'REST calls, action chains, rules, BI reports, actions, integrations, navigation', state: 'todo' },
            { label: v.commit ? 'Commit & push it for the team' : 'Commit & push it (off: kept on this PC)', detail: v.commit ? 'to ' + ((v.git && v.git.branch) || 'the data branch') : '', state: v.commit ? 'todo' : 'skipped' },
          ];
          let cap = 40;
          const show = (pct) => { v.steps = { title: 'Building the sheet of ' + ((v.sheet && v.sheet.facts && v.sheet.facts.label) || id), pct: Math.round(pct), list: list.map((x) => Object.assign({}, x)) }; };
          let pct = 4;
          show(pct);
          const ease = setInterval(() => { pct = Math.min(cap, pct + Math.max(0.6, (cap - pct) * 0.12)); show(pct); }, 250);
          try {
            const r = await PC.build(id, false);
            const b = r.body || {};
            if (!b.ok) { clearInterval(ease); list[0].state = 'failed'; list[0].detail = b.error || 'It could not be read.'; show(pct); v.result = { ok: false, text: b.error || 'That did not work.' }; return; }
            const f = (b.sheet && b.sheet.facts) || {};
            const n = (x) => (Array.isArray(x) ? x.length : 0);
            const lg = f.logic || {}, ig = f.integrations || {}, ft = f.features || {};
            list[0].state = 'done'; list[0].detail = ((b.sheet && b.sheet.codeHash) ? 'code ' + b.sheet.codeHash : '');
            list[1].state = 'done';
            list[1].detail = [n(ig.rest) + ' REST calls', n(lg.chains) + ' action chains', n(lg.modules) + ' rules modules', n(ig.reports) + ' BI reports', n(ft.actions) + ' actions', n(ig.backends) + ' services'].join(' · ');
            pct = Math.max(pct, 60); cap = v.commit ? 92 : 100;
            if (v.commit) list[2].state = 'active';
            show(pct);
            let git = null;
            if (v.commit) {
              const g = await PC.gitSave('Application pages: sheet of ' + id);
              git = g.body || {};
              list[2].state = git.ok ? 'done' : 'failed';
              list[2].detail = git.ok ? (git.nothing ? 'nothing new to commit' : 'pushed' + (git.upstream ? ' to ' + git.upstream : '')) : (git.error || 'git failed.') + (git.hint ? ' ' + git.hint : '');
            }
            clearInterval(ease); cap = 100; pct = 100; show(pct);
            v.result = { ok: !git || git.ok, text: ('The technical sheet is saved.' + gitNote(git)).trim() };
            await refresh();
          } finally {
            clearInterval(ease);
            setTimeout(() => { if (v.steps && v.steps.pct === 100) v.steps = null; }, 6000);
          }
          return;
        }
        if (act === 'capture') {
          const ws = !!v.codeFrom;
          v.progress = ws ? 'Building your workspace\'s working folder (when its code changed), then opening the page there and capturing it…' : 'Opening the page in a hidden window and capturing it (up to 30 s)…';
          const r = await PC.capture(id, v.commit);
          const b = r.body || {};
          // what the screenshot is of: your working folder's code (built just now?), and where the page went
          const from = b.from === 'workspace' ? ' From your workspace\'s working folder' + (b.built ? ' (built just now, with your changes).' : ' (your changes included).') : '';
          const went = b.landed ? ' Note: the page did not show itself — it sent you to ' + b.landed + ' (a guard: a module turned off, or a role it is not for), so the screenshot shows that page.' : '';
          await done(r, 'Screenshot captured.' + from + went);
          if (b.ok && b.shot) {
            const n = ((v.sheet && v.sheet.screenshots) || []).findIndex((x) => x.id === b.shot.id) + 1;
            bus.toast('📸 Screenshot ' + (n || '') + ' captured' + (b.from === 'workspace' ? ' — from your workspace' : '') + (b.landed ? ' (the page sent you to ' + b.landed + ')' : ''), b.landed ? 'warning' : 'success');
            arrived(b.shot.id);
          }
          return;
        }
        if (act === 'run') {
          v.progress = v.codeFrom ? 'Building your workspace\'s working folder (when its code changed) and opening the page in a window…' : 'Opening the page in a window…';
          const r = await PC.run(id);
          const b = r.body || {};
          v.result = r.ok && b.ok ? { ok: true, text: 'Opened in a window: ' + b.url + (b.from === 'workspace' ? ' — your workspace\'s working folder' + (b.built ? ', built just now' : '') + '.' : '.') } : { ok: false, text: b.error || 'It could not be opened.' };
          return;
        }
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
          if (r && r.body && r.body.ok) { bus.toast(files.length > 1 ? '📸 ' + files.length + ' screenshots added' : '📸 Screenshot added', 'success'); if (r.body.shot) arrived(r.body.shot.id); }
          return;
        }
        // a screenshot deleted: the one in the viewer (its Delete), or a thumbnail's × (key: its place) — asked first
        if (act === 'unshot' || act === 'unshotAt') {
          const at = act === 'unshotAt' ? Number(key) : v.viewer;
          const s1 = shots[at];
          if (!s1) return;
          const d0 = dlg(), inViewer = !!(d0 && d0.open);
          let yes = true;
          try { yes = window.confirm('Delete screenshot ' + (at + 1) + ' of this page?\n\n' + (s1.caption ? s1.caption + ' — ' : '') + (s1.source === 'capture' ? 'captured' : 'uploaded') + ' ' + (s1.at ? new Date(s1.at).toLocaleString() : '') + (s1.by ? ' by ' + s1.by : '') + '\n\nIt is removed for everyone (the change is kept in git).'); } catch (e) { /* no DOM */ }
          if (!yes) return;
          const r = await PC.removeShot(id, s1.id, v.commit);
          await done(r, 'Screenshot ' + (at + 1) + ' deleted.');
          if (r && r.body && r.body.ok) bus.toast('Screenshot ' + (at + 1) + ' deleted', 'info');
          if (inViewer) {
            v.viewer = ((v.sheet && v.sheet.screenshots) || []).length ? Math.min(v.viewer, v.sheet.screenshots.length - 1) : -1;
            if (v.viewer < 0) { const d = dlg(); try { if (d && d.open) d.close(); } catch (e) { /* closed */ } }
          }
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
        v.busyAct = '';
      }
    }
  }
  return actChain;
});
