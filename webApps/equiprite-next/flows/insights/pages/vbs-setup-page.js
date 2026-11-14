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
    // ── the set-up's progress (git's own, read as it comes) ──
    progPct(prog) { return prog && prog.overall ? Math.max(0, Math.min(100, prog.overall)) : 0; }
    /** The step going on (Download the code…), beside the whole set-up's percentage. */
    progLabel(prog, fallback) {
      if (prog && prog.cancelled) return 'Stopping…';
      const st = prog && (prog.steps || []).filter((x) => x.state === 'active')[0];
      return st ? st.label : (fallback || 'Starting…');
    }
    /** What git says of that step (Receiving objects 40% (480 / 1200)), how much at what speed, how long so far. */
    progDetail(prog) {
      if (!prog || !prog.startedAt) return '';
      const s = Math.round((prog.elapsedMs || 0) / 1000);
      const time = Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60) + ' so far';
      const git = prog.phase !== 'working' && prog.label ? prog.label + (prog.pct ? ' ' + prog.pct + '%' : '') + (prog.count ? ' (' + prog.count + ')' : '') : '';
      return [git, prog.size && prog.speed ? prog.size + ' at ' + prog.speed : prog.size, time].filter(Boolean).join(' · ');
    }
    progSteps(prog) {
      const ICON = { done: '✓', active: '●', todo: '○', failed: '✗' };
      const steps = (prog && prog.steps) || [{ label: 'Connect to VB Studio', state: 'active' }, { label: 'Download the code', state: 'todo' }, { label: 'Check what came', state: 'todo' }, { label: 'Unpack the files into main', state: 'todo' }, { label: 'Make the working folder', state: 'todo' }];
      return steps.map((x) => ({ label: x.label, state: x.state, icon: ICON[x.state] || '○' }));
    }
    noWs(found, sel) { const p = V.project(found, sel); return !p ? '' : p.workspaces.length ? '' : 'No workspace read for this project yet: Build.Rite reads them from VB Studio…'; }
  }
  return PageModule;
});
