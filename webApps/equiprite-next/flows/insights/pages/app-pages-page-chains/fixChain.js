define(['vb/action/actionChain', 'vb/action/actions', 'resources/js/codeFixClient'], (ActionChain, Actions, FX) => {
  'use strict';

  // The Code fix tab (desktop/lib/codeFix.js does the work): open it, ask the AI for a change to the open page, ask
  // again with what to change in the proposal, preview it, approve it (pull, write, test), test again, run the browser
  // tests, commit (and push), undo, discard; pick the code folder; open an earlier fix.
  class fixChain extends ActionChain {
    async run(context, { act, key }) {
      const v = context.$page.variables;
      const id = v.selId;
      if (!act || !id) return;
      const ask = (text) => (typeof window === 'undefined' || !window.confirm ? true : window.confirm(text));
      const fail = (r, text) => {
        const b = (r && r.body) || {};
        v.fixResult = { ok: false, text: b.error || text || 'It did not work.', hint: b.hint || '', canSkipPull: !!b.canSkipPull, canForce: !!b.canForce };
      };
      const show = (r, text) => { if (r.body && r.body.fix) v.fix = r.body.fix; if (r.ok) v.fixResult = text ? { ok: true, text: text } : null; else fail(r); };
      const list = async () => { const r = await FX.list(id); v.fixList = (r.body && r.body.fixes) || []; v.fixPage = id; };

      if (act === 'open') {
        const i = await FX.info();
        v.fixInfo = i.ok ? i.body : { ok: false, error: (i.body && i.body.error) || 'Code Fix needs the desktop app.' };
        if (v.fixPage !== id) { v.fix = null; v.fixResult = null; v.fixRefine = ''; }
        if (!i.ok) return;
        await list();
        // the latest fix of this page still under way (proposed, applied…): shown again
        const last = v.fixList[0];
        if (!v.fix && last && /^(proposed|applied|needs-redo|questions)$/.test(last.status)) { const g = await FX.get(last.id); if (g.ok) v.fix = g.body.fix; }
        return;
      }
      // screenshots for the request (the page module read them from a paste, a drop or the file picker)
      if (act === 'images') {
        const got = FX.takeImages();
        const room = Math.max(0, 6 - v.fixImages.length);
        if (got.length) v.fixImages = v.fixImages.concat(got.slice(0, room).map((x, i) => Object.assign({}, x, { name: /^image\.(png|jpe?g)$/i.test(x.name) || !x.name ? 'Pasted image ' + (v.fixImages.length + i + 1) : x.name })));
        v.fixResult = got.length > room ? { ok: false, text: 'Up to 6 screenshots per request.' } : null;
        return;
      }
      if (act === 'unimg') { v.fixImages = v.fixImages.filter((x, i) => String(i) !== String(key)); return; }
      if (act === 'viewImg') {
        v.fixView = key;
        setTimeout(() => { try { const d = document.getElementById('fxImgDlg'); if (d && !d.open && d.showModal) d.showModal(); } catch (e) { /* no DOM */ } }, 30);
        return;
      }
      if (act === 'unviewImg') { try { const d = document.getElementById('fxImgDlg'); if (d && d.open) d.close(); } catch (e) { /* closed */ } v.fixView = ''; return; }
      if (act === 'imgClosed') { v.fixView = ''; return; }
      // the change history: every change to a page's code (here, and shared from other PCs), with its approvals
      if (act === 'scope') {
        v.fixScope = key === 'all' ? 'all' : 'page';
        if (v.fixScope === 'all') {
          const h = await FX.history('');
          v.fixHist = (h.body && h.body.changes) || [];
          v.fixHistInfo = { shared: !!(h.body && h.body.shared), branch: (h.body && h.body.branch) || '' };
          if (!h.ok) fail(h);
        }
        return;
      }
      if (act === 'openHist' && key) {
        const row = v.fixHist.filter((x) => x.id === key)[0];
        if (row && row.page && row.page !== v.selId) await Actions.callChain(context, { chain: 'selectChain', params: { id: row.page } }); // its page
        const g = await FX.get(key);
        if (g.ok) { v.fix = g.body.fix; v.fixResult = null; v.fixScope = 'page'; } else fail(g);
        return;
      }
      if (act === 'openFix') { const g = await FX.get(key); if (g.ok) { v.fix = g.body.fix; v.fixResult = null; } else fail(g); return; }
      if (act === 'new') { v.fix = null; v.fixResult = null; v.fixRefine = ''; return; }
      if (v.fixBusy) return;
      v.fixBusy = true;
      v.fixResult = null;
      const ai = (v.fixInfo && v.fixInfo.ai && v.fixInfo.ai.provider) || 'the AI';
      const branch = (v.fixInfo && v.fixInfo.branch) || 'the branch';
      try {
        if (act === 'pick') { const r = await FX.pick(); if (r.ok) v.fixInfo = r.body; else fail(r); return; }
        if (act === 'analyze' || act === 'refine') {
          const refine = act === 'refine';
          if (!refine && !v.fixReq.trim()) { v.fixResult = { ok: false, text: 'Say what should change on this page.' }; return; }
          if (refine && (!v.fix || !v.fixRefine.trim())) { v.fixResult = { ok: false, text: 'Say what to change in the proposal.' }; return; }
          v.fixProgress = (refine ? 'Asking ' + ai + ' again with what you said' : 'Reading the page\'s code and asking ' + ai) + ' — a careful answer takes a minute or two. Nothing is changed in the code.';
          const pics = v.fixImages.map((x) => ({ name: x.name, mime: x.mime, base64: x.base64 }));
          if (pics.length) v.fixProgress += ' The AI looks at your ' + pics.length + ' screenshot' + (pics.length === 1 ? '' : 's') + ' too.';
          // (asked again: the earlier proposal's screenshots go with it, or the ones attached now)
          const r = await FX.analyze(refine ? { id: id, request: v.fix.request, kind: v.fix.kind, refine: v.fixRefine.trim(), parent: v.fix.id, images: pics } : { id: id, request: v.fixReq.trim(), kind: v.fixKind, images: pics });
          // the request stays in its box (to tweak and ask again); what was asked of the proposal is cleared, box too
          if (r.ok) { v.fix = r.body.fix; if (refine) { v.fixRefine = ''; try { const el = document.getElementById('fxRefine'); if (el) el.value = ''; } catch (e) { /* no DOM */ } } } else fail(r);
          await list();
          return;
        }
        const fid = v.fix && v.fix.id;
        if (!fid) return;
        if (act === 'preview') {
          v.fixProgress = 'Opening the page as it is, then with the change (only in the app\'s built copy, for a moment), in a hidden window…';
          show(await FX.preview(fid), 'Before and after, below.');
          return;
        }
        if (act === 'apply' || act === 'applyNoPull') {
          const pull = act === 'apply';
          if (!ask('Apply this change to ' + v.fix.files.length + ' file(s) in ' + ((v.fixInfo && v.fixInfo.folder) || 'the code folder') + ' (branch ' + branch + ')?\n\n'
            + (pull ? 'It pulls ' + branch + ' first. ' : 'It does NOT pull first. ') + 'Then it runs the related tests, writes the files and tests again. Nothing is committed until you click Commit.')) return;
          v.fixProgress = (pull ? 'Pulling ' + branch + ', running' : 'Running') + ' the related tests on the code as it is, writing the files, testing again…';
          const r = await FX.apply(fid, !pull);
          show(r, r.ok ? 'Applied to ' + r.body.fix.files.length + ' file(s). ' + ((r.body.fix.applied && r.body.fix.applied.pull && r.body.fix.applied.pull.text) || '')
            + (r.body.fix.applied && r.body.fix.applied.live ? ' Reload the page to see it in this app.' : '') : '');
          await list();
          return;
        }
        if (act === 'test') { v.fixProgress = 'Running the checks and the related tests…'; show(await FX.test(fid), 'Tested again.'); return; }
        if (act === 'e2e') { v.fixProgress = 'Running the browser tests (this takes several minutes)…'; show(await FX.e2e(fid)); return; }
        if (act === 'undo' || act === 'undoForce') {
          if (!ask(act === 'undoForce' ? 'The files changed after the fix. Put them back as they were before the fix anyway (those later changes are lost)?' : 'Put the files back as they were before the fix?')) return;
          const r = await FX.undo(fid, act === 'undoForce');
          show(r, r.ok ? 'Undone: the files are as they were before the fix.' : '');
          await list();
          return;
        }
        if (act === 'commit' || act === 'push') {
          v.fixProgress = act === 'push' ? 'Committing and pushing…' : 'Committing…';
          const r = await FX.commit(fid, act === 'push');
          const c = r.ok && r.body.fix.commit;
          show(r, c ? 'Committed ' + c.sha + ' on ' + c.branch + (c.pushed ? ', pushed to ' + c.upstream + '.' : c.pushError ? ' — the push failed: ' + c.pushError : ' (not pushed).') : '');
          await list();
          return;
        }
        if (act === 'discard') { const r = await FX.discard(fid); if (r.ok) { v.fix = null; v.fixResult = { ok: true, text: 'Discarded.' }; } else fail(r); await list(); }
      } finally {
        v.fixBusy = false;
        v.fixProgress = '';
      }
    }
  }
  return fixChain;
});
