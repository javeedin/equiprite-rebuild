define([
  'vb/action/actionChain',
  'resources/js/fddClient',
  'resources/js/fddIndex',
  'resources/js/shellBus',
], (ActionChain, FC, FI, bus) => {
  'use strict';

  // The library's actions: Outline (read the document shipped with the app and list its sections), a section's text,
  // Make latest, Remove, Download the original, and Commit & push whatever FDD changes are not in git yet.
  const gitNote = (g) => (!g ? '' : g.ok ? (g.pushed ? ' Pushed to ' + g.upstream + '.' : g.nothing ? '' : ' Committed, not pushed.') : ' Git: ' + g.error);

  class actChain extends ActionChain {
    async run(context, { act, id, n }) {
      const v = context.$page.variables;
      const base = context.$application.path;
      const refresh = async () => {
        FC.forget();
        v.lib = (await FC.library(base)).body;
        if (v.canUpload) v.git = (await FC.gitStatus()).body || v.git;
      };

      if (act === 'close') { v.viewId = ''; v.outline = []; v.section = null; v.outlineFilter = ''; return; }

      if (act === 'view') {
        const d = (v.lib.docs || []).filter((x) => x.id === id)[0];
        const r = await FC.doc(base, id, d && d.uploadedAt);
        if (!r.ok) { bus.toast((r.body && r.body.error) || 'Could not read that FDD.', 'error'); return; }
        v.viewId = id; v.section = null; v.outlineFilter = '';
        v.outline = FI.outline(r.body).map((s, i) => Object.assign(s, { key: String(i) }));
        try { setTimeout(() => { const el = document.getElementById('flibOutline'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50); } catch (e) { /* no DOM */ }
        return;
      }

      if (act === 'section') {
        const d = (v.lib.docs || []).filter((x) => x.id === v.viewId)[0];
        const r = await FC.doc(base, v.viewId, d && d.uploadedAt);
        const s = r.ok ? r.body.sections[parseInt(n, 10)] : null;
        if (!s) return;
        const full = FI.section(r.body, s.n || s.t) || {};
        v.section = { key: String(n), n: s.n, t: s.t, x: s.x, parent: full.parent || '' };
        return;
      }

      if (act === 'download') {
        const ok = await FC.download(id);
        if (!ok) bus.toast('The document is not in this copy of the project.', 'error');
        return;
      }

      if (act === 'latest') {
        v.busy = true;
        try {
          const r = await FC.setLatest(id, v.upCommit);
          const b = r.body || {};
          if (!b.ok) { bus.toast(b.error || 'Could not change the latest.', 'error'); return; }
          await refresh();
          v.result = { ok: !b.git || b.git.ok, title: 'The latest is now ' + id + '.', lines: [('Analyze with AI starts on it.' + gitNote(b.git)).trim()], hint: b.git && !b.git.ok ? b.git.hint : '' };
        } finally { v.busy = false; }
        return;
      }

      if (act === 'remove') {
        const d = (v.lib.docs || []).filter((x) => x.id === id)[0];
        let yes = true;
        try { yes = window.confirm('Remove "' + (d ? d.name + (d.version ? ' v' + d.version : '') : id) + '" from the FDD library?' + (v.upCommit ? ' This is committed and pushed to git.' : '')); } catch (e) { /* no DOM */ }
        if (!yes) return;
        v.busy = true;
        try {
          const r = await FC.remove(id, v.upCommit);
          const b = r.body || {};
          if (!b.ok) { bus.toast(b.error || 'Could not remove it.', 'error'); return; }
          if (v.viewId === id) { v.viewId = ''; v.outline = []; v.section = null; }
          await refresh();
          v.result = { ok: !b.git || b.git.ok, title: 'Removed ' + id + '.', lines: [((b.latest ? 'The latest is ' + b.latest + '.' : 'The library is empty.') + gitNote(b.git)).trim()], hint: b.git && !b.git.ok ? b.git.hint : '' };
        } finally { v.busy = false; }
        return;
      }

      if (act === 'push') {
        v.busy = true;
        try {
          const r = await FC.gitSave({ message: 'FDD library: update' });
          const b = r.body || {};
          v.result = b.ok
            ? { ok: true, title: b.nothing ? 'Nothing to commit or push.' : 'Saved to git.', lines: b.nothing ? [] : [(b.committed ? 'Committed ' + b.committed : 'Committed earlier') + (b.pushed ? ', pushed to ' + b.upstream + '.' : '.')] }
            : { ok: false, title: 'Git did not finish', lines: [b.error || 'git failed.'], hint: b.hint || '' };
          await refresh();
        } finally { v.busy = false; }
      }
    }
  }
  return actChain;
});
