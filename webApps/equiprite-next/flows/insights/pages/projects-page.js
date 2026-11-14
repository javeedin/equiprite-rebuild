define(['resources/js/vbsView'], (V) => {
  'use strict';

  // Setup → Organizations & projects: binding helpers (desktop/lib/vbs.js does the work; the chains call it through
  // resources/js/vbsClient.js; resources/js/vbsView.js turns what was found into rows). None uses `this`.
  const when = V.when;
  const plural = V.plural;
  const orgKey = V.orgKey;
  const inOrg = (x, fOrg) => !fOrg || orgKey(x) === fOrg;
  const matches = V.matches;
  /** Sync from VB Studio's steps: live while it runs, else the last sync's. */
  const stepsOf = (f) => (f && (f.syncLive || (f.sync && f.sync.steps))) || [];

  class PageModule {
    subText(orgs, found) { return !(orgs || []).length ? 'Start by adding your Visual Builder Studio organization.' : plural(orgs.length, 'organization') + ' · ' + plural(((found && found.projects) || []).length, 'project') + ' in VB Studio'; }
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
      if (f.sync && f.sync.ok) return 'Open a project to see its workspaces.';
      return f.at ? 'Read from VB Studio, last on ' + when(f.at) + '. Open a project to see its workspaces.' : '';
    }
    foundCounts(f, fOrg, fText) {
      if (!f) return '';
      const rows = V.projectRows(f, fOrg, fText);
      return plural(rows.length, 'project') + ' · ' + plural(rows.reduce((n, r) => n + r.repos, 0), 'repository', 'repositories') + ' · ' + plural(rows.reduce((n, r) => n + r.ws, 0), 'workspace');
    }
    /** The projects listed: name (opens its tab), id, organization, repositories, workspaces. */
    projectRows(f, fOrg, fText) { return V.projectRows(f, fOrg, fText); }
    noProjects(f, fOrg, fText) {
      if (String(fText || '').trim()) return 'No project matches “' + String(fText).trim() + '”.';
      if (((f && f.projects) || []).length) return 'No project in this organization.';
      return 'No project read yet: click Sync from VB Studio.';
    }
    /** Organizations found in VB Studio, not set up here (Set up: their sign-in). */
    otherOrgs(f) { return ((f && f.orgs) || []).filter((o) => !o.orgId).map((o) => ({ key: orgKey(o), url: o.url, org: o.org })); }
    repoHint(o) { return o ? 'https://' + o.host + '/' + o.org + '/s/' + o.org + '_<project>/scm/<repository>.git' : ''; }
  }

  return PageModule;
});
