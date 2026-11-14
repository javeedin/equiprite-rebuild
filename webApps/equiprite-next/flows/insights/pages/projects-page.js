define([], () => {
  'use strict';

  // Setup → Organizations & projects: binding helpers (desktop/lib/vbs.js does the work; the chains call it through
  // resources/js/vbsClient.js). None uses `this`.
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const when = (at) => { const d = new Date(at); if (isNaN(d.getTime())) return ''; const p2 = (n) => (n < 10 ? '0' : '') + n; return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const orgKey = (o) => o.host + '/' + o.org;
  const projKey = (p) => p.host + '/' + p.org + '/' + p.project;
  const inOrg = (x, fOrg) => !fOrg || orgKey(x) === fOrg;
  const matches = (p, t) => { const q = String(t || '').trim().toLowerCase(); return !q || [p.name, p.project, p.description].some((v) => String(v || '').toLowerCase().indexOf(q) !== -1); };
  /** A workspace of a project: by the project's id, or (read without it) its short name (the id without its number), its name. */
  const wsMatch = (w, p) => w.host === p.host && w.org === p.org && !!w.project && (w.project === p.project || w.project === String(p.project).replace(/_\d+$/, '') || (!!p.name && w.project === p.name));
  const wsOf = (f, p) => ((f && f.workspaces) || []).filter((w) => wsMatch(w, p));
  /** When a workspace was last opened: a date (or seconds / milliseconds) shown as a date, else as VB Studio says it. */
  const opened = (v) => { const t = String(v || ''); if (!t) return '—'; const n = /^\d{10}$/.test(t) ? Number(t) * 1000 : /^\d{12,13}$/.test(t) ? Number(t) : t; const d = new Date(n); return isNaN(d.getTime()) ? t : when(d.toISOString()); };
  const wsRow = (w, f) => {
    const p = ((f && f.projects) || []).filter((x) => wsMatch(w, x))[0];
    return { name: w.name, owner: w.owner || '', project: p ? (p.name || p.project) : (w.project || '—'), projectKey: p ? projKey(p) : '', branch: w.branch || '—', repo: w.repo || '—',
      environment: w.environment || '—', lastOpened: opened(w.lastOpened), url: w.url || '' };
  };
  /** Sync from VB Studio's steps: live while it runs, else the last sync's. */
  const stepsOf = (f) => (f && (f.syncLive || (f.sync && f.sync.steps))) || [];

  class PageModule {
    subText(orgs, projects) { return !(orgs || []).length ? 'Start by adding your Visual Builder Studio organization.' : plural(orgs.length, 'organization') + ' · ' + plural((projects || []).length, 'project'); }
    orgClass(id, sel) { return 'nx-vbs-org' + (id === sel ? ' nx-vbs-org--on' : ''); }
    org(orgs, sel) { return (orgs || []).filter((o) => o.id === sel)[0] || null; }
    /** Signed in (the last check), refused, or not checked yet. */
    status(o) {
      if (!o) return { cls: '', text: '' };
      if (!o.hasPassword) return { cls: 'nx-vbs-st nx-vbs-st--bad', text: 'No password on this PC: enter it again' };
      if (!o.checked) return { cls: 'nx-vbs-st', text: 'Not checked yet: add a project to check the sign-in' };
      return o.checked.ok ? { cls: 'nx-vbs-st nx-vbs-st--ok', text: '✓ Signed in · ' + when(o.checked.at) } : { cls: 'nx-vbs-st nx-vbs-st--bad', text: '✗ ' + o.checked.message + ' · ' + when(o.checked.at) };
    }
    orgMeta(o) { return !o ? '' : o.user + ' · ' + plural(o.projects || 0, 'project'); }
    keyNote(o) { return !o ? '' : o.keychain ? 'The password is kept encrypted on this PC (the system\'s keychain); it is never shown again.' : 'This PC cannot encrypt it: the password is kept for this run only.'; }
    formTitle(editId) { return editId ? 'Edit the organization' : 'Add an organization'; }
    passHint(editId) { return editId ? 'Leave empty to keep the saved password' : 'Kept encrypted on this PC'; }
    /** The organization's projects, as cards. */
    projectsOf(projects, sel) {
      return (projects || []).filter((p) => p.orgId === sel).map((p) => ({
        id: p.id, name: p.name, project: p.project, repo: p.repo, repoUrl: p.repoUrl, head: p.head || '—',
        branches: (p.branches || []).slice(0, 40), moreBranches: (p.branches || []).length > 40 ? '+' + ((p.branches || []).length - 40) + ' more' : '',
        branchCount: plural((p.branches || []).length, 'branch', 'branches'), jobs: p.jobs || [], jobCount: plural((p.jobs || []).length, 'build job'),
        jobsNote: p.jobsError ? 'Build jobs: ' + p.jobsError : (p.jobs || []).length ? '' : 'No build jobs in this project yet.',
        checked: p.checkedAt ? 'Checked ' + when(p.checkedAt) : '', error: p.error || '',
      }));
    }
    // ── Find in VB Studio ──
    hasFound(f) { return !!f && ((f.orgs || []).length + (f.projects || []).length + (f.workspaces || []).length > 0 || !!(f.finder && (f.finder.open || (f.finder.log || []).length)) || stepsOf(f).length > 0); }
    // ── the filter: an organization (its projects), the projects by name; a project opened (its workspaces) ──
    showFilters(f, orgs) { return ((f && f.projects) || []).length > 0 || ((f && f.orgs) || []).length > 1; }
    orgChips(f, orgs, fOrg) {
      const map = {};
      ((f && f.orgs) || []).forEach((o) => { map[orgKey(o)] = { key: orgKey(o), label: o.org, n: 0 }; });
      (orgs || []).forEach((o) => { const k = orgKey(o); map[k] = Object.assign(map[k] || { key: k, n: 0 }, { label: o.name || o.org }); });
      ((f && f.projects) || []).forEach((p) => { const k = p.host + '/' + p.org; if (map[k]) map[k].n++; });
      const list = Object.keys(map).map((k) => map[k]).sort((a, b) => b.n - a.n || String(a.label).localeCompare(String(b.label)));
      return [{ key: '', label: 'All organizations', n: ((f && f.projects) || []).length }].concat(list)
        .map((c) => ({ key: c.key, label: c.label, n: c.n, on: c.key === (fOrg || ''), cls: 'nx-vbs-fchip' + (c.key === (fOrg || '') ? ' nx-vbs-fchip--on' : '') }));
    }
    /** "Showing 12 of 77 projects" while a filter is on. */
    filterNote(f, fOrg, fText) {
      const all = (f && f.projects) || [];
      const shown = all.filter((p) => inOrg(p, fOrg) && matches(p, fText)).length;
      if (!fOrg && !String(fText || '').trim()) return '';
      return 'Showing ' + shown + ' of ' + plural(all.length, 'project') + (String(fText || '').trim() ? ' matching “' + String(fText).trim() + '”' : '') + '.';
    }
    /** The breadcrumb: All organizations ▸ the organization ▸ the project. */
    crumbOrg(f, orgs, fOrg) { if (!fOrg) return ''; const s = (orgs || []).filter((o) => orgKey(o) === fOrg)[0]; return s ? (s.name || s.org) : fOrg.split('/').pop(); }
    crumbProject(f, fProject) { const p = ((f && f.projects) || []).filter((x) => projKey(x) === fProject)[0]; return p ? (p.name || p.project) : ''; }
    /** The project opened: its repositories (Add) and its workspaces. */
    projectView(f, fProject) {
      const p = ((f && f.projects) || []).filter((x) => projKey(x) === fProject)[0];
      if (!p) return null;
      const ws = wsOf(f, p);
      const learned = (f && f.learned) || {};
      return { key: projKey(p), orgKey: p.host + '/' + p.org, name: p.name || p.project, project: p.project, org: p.org, description: p.description || '', orgSetUp: !!p.orgId,
        repos: (p.repos || []).map((r) => ({ repo: r.repo, url: r.url, added: !!r.added })), noRepo: !(p.repos || []).length,
        workspaces: ws.map((w) => wsRow(w, f)), wsTitle: 'Workspaces · ' + ws.length,
        wsNote: ws.length ? '' : learned.workspaces ? 'No workspace found in this project yet (as of the last sync): Refresh it from VB Studio.' : 'Build.Rite has not seen VB Studio\'s Workspaces page yet: Open VB Studio, open this project\'s Workspaces page (Designer → Workspaces), close the window — then Sync reads every project\'s workspaces itself.',
        canRefresh: !!(learned.repos || learned.workspaces) };
    }
    // ── Sync from VB Studio (API) ──
    syncStepCount(f) { return stepsOf(f).length; }
    syncStepsText(f) {
      const p2 = (n) => (n < 10 ? '0' : '') + n;
      return stepsOf(f).map((l) => { const d = new Date(l.at); return (isNaN(d.getTime()) ? '' : p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds())) + '  ' + l.text; }).join('\n');
    }
    syncClass(f) { const s = f && f.sync; return 'nx-vbs-sync' + (f && f.syncLive ? '' : s && s.ok ? ' nx-vbs-sync--ok' : s ? ' nx-vbs-sync--bad' : ''); }
    /** The last sync in one line: when, what it read, how it signed in (or what to do first). */
    syncLine(f, running) {
      if (running || (f && f.syncLive)) { const st = stepsOf(f); return 'Syncing through VB Studio\'s API… ' + (st.length ? st[st.length - 1].text : ''); }
      const s = f && f.sync;
      if (!s) return '';
      const c = s.counts || {};
      const via = s.via || {};
      const ways = [via.basic ? 'your username and password' : '', via.page ? 'your VB Studio session' : '', via.session ? 'the VB Studio window\'s session' : '', via.window ? 'the VB Studio window\'s sign-in' : ''].filter(Boolean);
      if (!s.ok) return '✗ Synced on ' + when(s.at) + ': nothing read. ' + (s.signIn ? 'VB Studio needs you to sign in: Open VB Studio, sign in, close it — then Sync again.' : s.needLearn ? 'Build.Rite has not seen VB Studio\'s project list yet: Open VB Studio once, go to the organization\'s page, close it — then Sync again.' : 'See what Sync did.');
      return '✓ Synced through VB Studio\'s API on ' + when(s.at) + ': ' + plural(c.projects || 0, 'project') + ' · ' + plural(c.repos || 0, 'repository', 'repositories') + ' · ' + plural(c.workspaces || 0, 'workspace')
        + (ways.length ? ' — signed in with ' + ways.join(' and ') : '') + (s.needLearn ? '. Its project list not learned yet: Open VB Studio once on the organization\'s page.' : '');
    }
    /** The VB Studio window's log: each step it took (addresses without their query), oldest first. */
    finderLogCount(f) { return ((f && f.finder && f.finder.log) || []).length; }
    finderLogText(f) {
      const p2 = (n) => (n < 10 ? '0' : '') + n;
      return ((f && f.finder && f.finder.log) || []).map((l) => { const d = new Date(l.at); return (isNaN(d.getTime()) ? '' : p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds())) + '  ' + l.text; }).join('\n');
    }
    foundNote(f, watching) {
      if (!f) return '';
      if ((f.finder && f.finder.open) || watching) return 'The VB Studio window is open: sign in as usual, open the organization\'s page, then a project\'s Repositories and Workspaces — what VB Studio shows appears here.';
      if (f.sync && f.sync.ok) return 'Sync from VB Studio reads these through VB Studio\'s API, without a window. Open VB Studio only to teach Build.Rite a page it has not seen.';
      return f.at ? 'Read from VB Studio\'s pages, last on ' + when(f.at) + '. Sync from VB Studio now makes the same calls itself (no window).' : '';
    }
    foundCounts(f, fOrg, fText) {
      if (!f) return '';
      const pr = (f.projects || []).filter((p) => inOrg(p, fOrg) && matches(p, fText));
      const ws = (f.workspaces || []).filter((w) => inOrg(w, fOrg) && (!String(fText || '').trim() || pr.some((p) => wsMatch(w, p))));
      return plural((f.orgs || []).filter((o) => inOrg(o, fOrg)).length, 'organization') + ' · ' + plural(pr.length, 'project') + ' · ' + plural(pr.reduce((n, p) => n + (p.repos || []).length, 0), 'repository', 'repositories') + ' · ' + plural(ws.length, 'workspace');
    }
    foundOrgs(f, fOrg) {
      const all = (f && f.projects) || [];
      return ((f && f.orgs) || []).filter((o) => inOrg(o, fOrg)).map((o) => { const n = all.filter((p) => p.host === o.host && p.org === o.org).length; return { key: orgKey(o), url: o.url, org: o.org, host: o.host, setUp: !!o.orgId, n: n, show: fOrg !== orgKey(o) && n > 0, showText: 'Its projects · ' + n }; });
    }
    foundProjects(f, fOrg, fText) {
      return ((f && f.projects) || []).filter((p) => inOrg(p, fOrg) && matches(p, fText)).map((p) => { const n = wsOf(f, p).length; return { key: projKey(p), name: p.name || p.project, project: p.project, org: p.org, description: p.description || '', orgSetUp: !!p.orgId,
        noRepo: !(p.repos || []).length, wsText: 'Workspaces · ' + n + ' ›',
        repos: (p.repos || []).map((r) => ({ repo: r.repo, url: r.url, added: !!r.added })) }; });
    }
    foundWorkspaces(f, fOrg, fText) {
      const shown = ((f && f.projects) || []).filter((p) => matches(p, fText));
      return ((f && f.workspaces) || []).filter((w) => inOrg(w, fOrg) && (!String(fText || '').trim() || shown.some((p) => wsMatch(w, p)))).map((w) => wsRow(w, f));
    }
    repoHint(o) { return o ? 'https://' + o.host + '/' + o.org + '/s/' + o.org + '_<project>/scm/<repository>.git' : ''; }
  }

  return PageModule;
});
