define(['resources/js/vbsView'], (V) => {
  'use strict';

  // A VB Studio project's tab: binding helpers (resources/js/vbsView.js turns what desktop/lib/vbs.js found into rows).
  // No function uses `this` (a binding may call one detached).
  const p2 = (n) => (n < 10 ? '0' : '') + n;
  const clock = (at) => { const d = new Date(at); return isNaN(d.getTime()) ? '' : p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()); };

  class PageModule {
    proj(found, key) { return V.project(found, key); }
    title(found, key, name) { const p = V.project(found, key); return p ? p.name : (name || String(key || '').split('/').pop() || 'Project'); }
    sub(found, key) { const p = V.project(found, key); return p ? 'Project ' + p.project + ' · ' + p.org + (p.description ? ' · ' + p.description : '') : ''; }
    wsTitle(found, key) { const p = V.project(found, key); return 'Workspaces · ' + (p ? p.workspaces.length : 0); }
    reposTitle(found, key) { const p = V.project(found, key); return 'Repositories · ' + (p ? p.repos.length : 0); }
    /** Its workspaces, filtered by name, owner, branch, repository or environment. */
    wsRows(found, key, q) {
      const p = V.project(found, key);
      const t = String(q || '').trim().toLowerCase();
      return !p ? [] : p.workspaces.filter((w) => !t || [w.name, w.owner, w.branch, w.repo, w.environment].some((x) => String(x || '').toLowerCase().indexOf(t) !== -1));
    }
    /** Where the workspaces shown come from: refreshing now, the last refresh (when, how many), or what Build.Rite read before. */
    status(refresh, refreshing, found, key) {
      if (refreshing) return 'Reading this project\'s workspaces and repositories from VB Studio…';
      const p = V.project(found, key);
      const n = p ? p.workspaces.length : 0;
      if (refresh && refresh.ok) return '✓ Read from VB Studio at ' + clock(refresh.at) + ': ' + V.plural(n, 'workspace') + ', ' + V.plural(p ? p.repos.length : 0, 'repository', 'repositories') + '.';
      if (refresh && !refresh.ok) return '✗ Not read at ' + clock(refresh.at) + ': ' + (refresh.error || 'VB Studio did not answer.') + ' See what the refresh did, below.';
      return n ? 'As Build.Rite last read them from VB Studio. Refresh workspaces to read them again.' : '';
    }
    noWs(refresh, refreshing, q) {
      if (String(q || '').trim()) return 'No workspace matches “' + String(q).trim() + '”.';
      if (refreshing) return 'Reading them from VB Studio…';
      if (refresh && refresh.ok) return 'VB Studio lists no workspace in this project.';
      if (refresh && !refresh.ok) return 'Could not read them: ' + (refresh.error || 'VB Studio did not answer.');
      return 'Not read yet: click Refresh workspaces.';
    }
    // ── the workspace chosen: open it; its Git ──
    wsChosen(found, key, sel) { const p = V.project(found, key); return (p && sel && p.workspaces.filter((w) => w.key === sel)[0]) || null; }
    wsMeta(w) { return !w ? '' : [w.owner, w.environment !== '—' ? 'environment ' + w.environment : '', w.lastOpened !== '—' ? 'last opened ' + w.lastOpened : ''].filter(Boolean).join(' · '); }
    gitHead(g, busy) {
      if (busy) return 'Reading its Git…';
      if (!g) return '—';
      if (!g.ok) return '✗ ' + (g.error || 'Not read.');
      return g.sha.slice(0, 10) + (g.commitError ? ' (its last commit could not be read: ' + g.commitError + ')' : '');
    }
    commitBy(g) { const c = g && g.commit; return !c ? '' : c.author + ' · ' + V.when(c.date) + ' · ' + String(c.sha || '').slice(0, 10); }
    filesTitle(g) { const n = ((g && g.files) || []).length + ((g && g.more) || 0); return n === 1 ? 'The file it changed' : 'The ' + n + ' files it changed'; }
    gitFiles(g) {
      const LABEL = { A: 'added', M: 'changed', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed' };
      return ((g && g.files) || []).map((f) => ({ status: f.status, label: LABEL[f.status] || f.status, path: f.path }));
    }
    stepCount(refresh) { return ((refresh && refresh.steps) || []).length; }
    stepsText(refresh) { return ((refresh && refresh.steps) || []).map((s) => clock(s.at) + '  ' + s.text).join('\n'); }
  }

  return PageModule;
});
