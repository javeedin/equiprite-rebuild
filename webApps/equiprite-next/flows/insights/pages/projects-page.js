define([], () => {
  'use strict';

  // Setup → Organizations & projects: binding helpers (desktop/lib/vbs.js does the work; the chains call it through
  // resources/js/vbsClient.js). None uses `this`.
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const when = (at) => { const d = new Date(at); if (isNaN(d.getTime())) return ''; const p2 = (n) => (n < 10 ? '0' : '') + n; return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

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
    hasFound(f) { return !!f && ((f.orgs || []).length + (f.projects || []).length + (f.workspaces || []).length > 0 || !!(f.finder && (f.finder.open || (f.finder.log || []).length))); }
    /** The VB Studio window's log: each step it took (addresses without their query), oldest first. */
    finderLogCount(f) { return ((f && f.finder && f.finder.log) || []).length; }
    finderLogText(f) {
      const p2 = (n) => (n < 10 ? '0' : '') + n;
      return ((f && f.finder && f.finder.log) || []).map((l) => { const d = new Date(l.at); return (isNaN(d.getTime()) ? '' : p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds())) + '  ' + l.text; }).join('\n');
    }
    foundNote(f, watching) {
      if (!f) return '';
      if ((f.finder && f.finder.open) || watching) return 'The VB Studio window is open: sign in as usual, open the organization\'s page, then a project\'s Repositories and Workspaces — what VB Studio shows appears here.';
      return f.at ? 'Read from VB Studio\'s pages, last on ' + when(f.at) + '. Open VB Studio again to find more.' : '';
    }
    foundCounts(f) { return !f ? '' : plural((f.orgs || []).length, 'organization') + ' · ' + plural((f.projects || []).length, 'project') + ' · ' + plural((f.projects || []).reduce((n, p) => n + (p.repos || []).length, 0), 'repository', 'repositories') + ' · ' + plural((f.workspaces || []).length, 'workspace'); }
    foundOrgs(f) { return ((f && f.orgs) || []).map((o) => ({ url: o.url, org: o.org, host: o.host, setUp: !!o.orgId })); }
    foundProjects(f) {
      return ((f && f.projects) || []).map((p) => ({ key: p.host + '/' + p.org + '/' + p.project, name: p.name || p.project, project: p.project, org: p.org, description: p.description || '', orgSetUp: !!p.orgId,
        guess: 'https://' + p.host + '/' + p.org + '/s/' + p.org + '_' + p.project + '/scm/' + p.project + '.git', noRepo: !(p.repos || []).length,
        repos: (p.repos || []).map((r) => ({ repo: r.repo, url: r.url, added: !!r.added })) }));
    }
    foundWorkspaces(f) { return ((f && f.workspaces) || []).map((w) => ({ name: w.name, project: w.project || '—', branch: w.branch || '—', repo: w.repo || '—', owner: w.owner || '—' })); }
    repoHint(o) { return o ? 'https://' + o.host + '/' + o.org + '/s/' + o.org + '_<project>/scm/<repository>.git' : ''; }
  }

  return PageModule;
});
