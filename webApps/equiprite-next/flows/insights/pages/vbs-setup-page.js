define(['resources/js/vbsView'], (V) => {
  'use strict';

  // Set up your workspace: binding helpers (resources/js/vbsView.js turns what VB Studio gave into rows). No `this`.
  const STEPS = [[1, 'Workspace'], [2, 'Folder'], [3, 'Preview'], [4, 'Set']];
  const orgKey = (o) => o.host + '/' + o.org;
  class PageModule {
    steps(step) { return STEPS.map((s) => ({ n: s[0], label: s[1], cls: 'nx-vbsu-step' + (s[0] === step ? ' nx-vbsu-step--on' : s[0] < step ? ' nx-vbsu-step--done' : '') })); }
    /** The organizations (found, with their projects): All first. */
    orgChips(found, fOrg) {
      const m = {};
      ((found && found.projects) || []).forEach((p) => { const k = orgKey(p); m[k] = m[k] || { key: k, label: p.org, n: 0 }; m[k].n++; });
      const list = Object.keys(m).map((k) => m[k]).sort((a, b) => b.n - a.n);
      return list.length < 2 ? [] : [{ key: '', label: 'All', n: ((found && found.projects) || []).length }].concat(list).map((c) => ({ key: c.key, label: c.label, n: c.n, cls: 'nx-chip nx-chip--sm' + (c.key === (fOrg || '') ? ' nx-chip--on' : '') }));
    }
    projects(found, fOrg, q, sel) { return V.projectRows(found, fOrg, q).map((r) => Object.assign({}, r, { cls: 'nx-vbsu-pick' + (r.key === sel ? ' nx-vbsu-pick--on' : '') })); }
    project(found, sel) { return V.project(found, sel); }
    workspaces(found, sel, selWs) { const p = V.project(found, sel); return !p ? [] : p.workspaces.map((w) => Object.assign({}, w, { cls: 'nx-vbsu-ws' + (w.key === selWs ? ' nx-vbsu-ws--on' : '') })); }
    chosenWs(found, sel, selWs) { const p = V.project(found, sel); return (p && p.workspaces.filter((w) => w.key === selWs)[0]) || null; }
    canNext(step, found, sel, selWs, folder) {
      if (step === 1) { const p = V.project(found, sel); const ws = p && p.workspaces.filter((x) => x.key === selWs)[0]; return !!(ws && ws.repo && ws.repo !== '—' && ws.branchName); }
      if (step === 2) return !!String(folder || '').trim();
      return true;
    }
    /** Where it goes (before the plan is read): <folder>/<project>-<workspace>/ main, working. */
    whereText(folder, found, sel, selWs) {
      const p = V.project(found, sel);
      const w = p && p.workspaces.filter((x) => x.key === selWs)[0];
      if (!p || !w || !String(folder || '').trim()) return '';
      const sep = /\\/.test(folder) ? '\\' : '/';
      const name = (V.shortId(p.project) + '-' + w.name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
      const base = String(folder).replace(/[\\/]+$/, '') + sep + name;
      return 'Build.Rite makes ' + base + sep + ' with two folders in it: main and working.';
    }
    wsLine(w) { return !w ? '' : [w.owner, 'branch ' + (w.branchName || '—'), w.repo !== '—' ? w.repo + '.git' : '', w.lastOpened !== '—' ? 'last opened ' + w.lastOpened : ''].filter(Boolean).join(' · '); }
    chosenText(found, sel, selWs) { const p = V.project(found, sel); const w = p && p.workspaces.filter((x) => x.key === selWs)[0]; return p && w ? p.name + ' ▸ ' + w.name : ''; }
    planWhere(plan, found, sel) { const p = V.project(found, sel); return !plan ? '' : 'in ' + (p ? p.name : plan.project) + ' · ' + String(plan.orgKey || '').split('/').pop(); }
    mainNote(plan) { return !plan ? '' : 'VB Studio\'s ' + plan.branch + ', exactly. What is applied here is pushed back to VB Studio — never forced.'; }
    noWs(found, sel) { const p = V.project(found, sel); return !p ? '' : p.workspaces.length ? '' : 'No workspace read for this project yet: Build.Rite reads them from VB Studio…'; }
  }
  return PageModule;
});
