define(['resources/js/issuesClient', 'resources/js/codeFixClient', 'resources/js/storyAnalysis', 'resources/js/shellBus', 'resources/js/pagesClient'], (IC, FX, SA, bus, PC) => {
  'use strict';

  // Issues: binding helpers (desktop/lib/issues.js does the work; the chains call it). None uses `this`.
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const when = (at) => { const d = new Date(at); if (isNaN(d.getTime())) return ''; const p2 = (n) => (n < 10 ? '0' : '') + n; return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); };
  const STATUS = { new: 'Logged', written: 'Written up', analyzed: 'Analyzed', triaged: 'Triaged', 'needs-info': 'Needs information', 'awaiting-approval': 'Waiting for approval',
    approved: 'Approved', rejected: 'Rejected', 'in-review': 'Pull request', verified: 'Verified', closed: 'Closed' };
  // the defect record's choices (desktop/lib/issues.js keeps the same)
  const SEV = [['critical', 'S1', 'Critical', 'The system or a main flow is down, data lost or wrong, no workaround'], ['major', 'S2', 'Major', 'A main function does not work; the workaround is hard'],
    ['minor', 'S3', 'Minor', 'Works with a workaround, or affects few'], ['trivial', 'S4', 'Trivial', 'Cosmetic: a label, a colour, a typo']];
  const PRI = [['p1', 'P1', 'Urgent', 'Now: it blocks production or a release'], ['p2', 'P2', 'High', 'In the next build'], ['p3', 'P3', 'Medium', 'Planned'], ['p4', 'P4', 'Low', 'When there is time']];
  const ENVS = ['DEV', 'SIT', 'UAT', 'PROD'];
  const RES = [['fixed', 'Fixed'], ['done', 'Done'], ['as-designed', 'Works as designed'], ['out-of-scope', 'Out of scope'], ['moved', 'Fixed elsewhere'], ['duplicate', 'Duplicate'], ['cannot-reproduce', 'Cannot reproduce'], ['wont-fix', 'Won\'t fix']];
  const CAUSE = [['code', 'Code defect'], ['config', 'Configuration'], ['data', 'Data'], ['requirement', 'Requirement gap'], ['environment', 'Environment'], ['integration', 'Integration'], ['user', 'User error / training'], ['none', 'None']];
  const CKIND = [['comment', 'Comment', 'Everyone sees it; in Jira too'], ['response', 'Response to the customer', 'Can be emailed to the reporter'], ['internal', 'Internal note', 'The team only: not in Jira'],
    ['email', '✉ Email', 'An email from Microsoft 365 — asking for more information, a status update… — kept here']];
  const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
  const RANK = { critical: 0, major: 1, minor: 2, trivial: 3, p1: 0, p2: 1, p3: 2, p4: 3 };
  const dateText = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || '')); return m ? Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[1] : ''; };
  // the builds (apps): their short names and colours, as in Application pages
  const APPS = [['vbredwoodapp', 'Old EquipRite', 'OLD'], ['equiprite', 'New EquipRite', 'NEW'], ['equiprite-next', 'EquipRite Next', 'NEXT'], ['equiprite-mobile', 'Mobile', 'MOB'], ['equiprite-future', 'Future', 'FUT']];
  const appOf = (x) => (x && (x.app || String(x.page || '').split('/')[0])) || '';
  const inScope = (x, scope) => !scope || appOf(x) === scope;
  const GROUPS = { open: ['new', 'written', 'analyzed', 'triaged', 'needs-info', 'awaiting-approval', 'approved', 'rejected'], approval: ['awaiting-approval'], review: ['approved', 'in-review', 'verified'], closed: ['closed'] };
  // what the agent does when Apply change is pressed (desktop/lib/issues.js AGENT_STEPS)
  const AGENT = [['fetch', 'Get the latest code'], ['branch', 'Make its own branch'], ['check', 'Check the change still fits the code'], ['before', 'Run the related tests, before the change'],
    ['write', 'Write the change'], ['after', 'Run the tests again, with the change'], ['commit', 'Commit it'], ['push', 'Push the branch'], ['pr', 'The pull request']];
  const secs = (n) => (n < 60 ? n + ' s' : Math.floor(n / 60) + ' min ' + (n % 60) + ' s');
  const panelOf = (x, sv) => (Number(sv) >= 0 ? Number(sv) : (x ? x.stage || 0 : 0));
  let shownKept = { k: '', v: [] };
  let tableKept = { k: '', v: [] };

  // Screenshots for a new issue: pasted (Ctrl+V), dropped or picked in its form (#isAsk). Read here during the paste (the
  // clipboard is gone after), handed to the chain through codeFixClient's queue and the issueImages event.
  let fire = null;
  function listen() {
    if (typeof document === 'undefined' || window.__nxIssueImages) return;
    window.__nxIssueImages = true;
    const inAsk = (t) => !!(t && t.closest && t.closest('#isAsk'));
    const filesOf = (dt) => {
      if (!dt) return [];
      const items = Array.prototype.filter.call(dt.items || [], (i) => i.kind === 'file' && /^image\//.test(i.type)).map((i) => i.getAsFile()).filter(Boolean);
      return items.length ? items : Array.prototype.filter.call(dt.files || [], (f) => /^image\//.test(f.type));
    };
    const take = (files) => { if (!files.length) return false; Promise.all(files.map((f) => FX.prepImage(f))).then((imgs) => { FX.queueImages(imgs.filter(Boolean)); if (fire) fire(); }); return true; };
    document.addEventListener('paste', (ev) => { if (inAsk(ev.target) && take(filesOf(ev.clipboardData))) ev.preventDefault(); });
    document.addEventListener('dragover', (ev) => { if (inAsk(ev.target)) ev.preventDefault(); });
    document.addEventListener('drop', (ev) => { if (!inAsk(ev.target)) return; ev.preventDefault(); take(filesOf(ev.dataTransfer)); });
    document.addEventListener('change', (ev) => { if (ev.target && ev.target.id === 'isImgFile') { take(Array.prototype.slice.call(ev.target.files || [])); ev.target.value = ''; } });
  }

  class PageModule {
    constructor(context) {
      const helper = context && typeof context.getEventHelper === 'function' ? context.getEventHelper() : null;
      fire = () => { if (helper) helper.fireCustomEvent('issueImages', {}); };
      // the build in scope changed in the top bar: the list follows it
      bus.onScope('issues', () => { if (helper) helper.fireCustomEvent('scopeChanged', {}); });
      bus.onFocus('issues', () => { if (helper) helper.fireCustomEvent('focusRequest', {}); });
      listen();
    }
    subText(c, info, scope) {
      const n = c || {};
      const b = APPS.filter((a) => a[0] === scope)[0];
      return (b ? b[1] + ': ' : 'All builds: ') + n.open + ' open · ' + n.approval + ' waiting for approval · ' + n.review + ' in review · ' + n.closed + ' closed' + (info && info.shared ? ' · shared with everyone' : '');
    }
    /** The counts of the issues of the build in scope (the filters, the subtitle). */
    countsIn(list, scope) {
      const l = (list || []).filter((x) => inScope(x, scope));
      const n = (g) => l.filter((x) => GROUPS[g].indexOf(x.status) !== -1).length;
      return { all: l.length, open: n('open'), approval: n('approval'), review: n('review'), closed: n('closed') };
    }
    builds() { return APPS.map((a) => ({ id: a[0], label: a[1], short: a[2] })); }
    appShort(x) { const a = APPS.filter((p) => p[0] === appOf(x))[0]; return a ? a[2] : 'VB'; }
    appName(x) { const a = APPS.filter((p) => p[0] === appOf(x))[0]; return a ? a[1] : appOf(x); }
    appClass(x) { return 'nx-is-app nx-is-app--' + (appOf(x) || 'none'); }
    buildName(id) { const a = APPS.filter((p) => p[0] === id)[0]; return a ? a[1] : ''; }
    filters(c) { const n = c || {}; return [['open', 'Open'], ['approval', 'Waiting for approval'], ['review', 'In review'], ['closed', 'Closed'], ['all', 'All']].map((f) => ({ id: f[0], label: f[1], n: n[f[0]] || 0 })); }
    shown(list, q, scope) {
      const k = (list || []).length + '|' + q + '|' + scope + '|' + (list || []).map((x) => x.id + x.status + x.updatedAt).join(',');
      if (shownKept.k === k) return shownKept.v;
      const s = String(q || '').trim().toLowerCase();
      shownKept = { k: k, v: (list || []).filter((x) => inScope(x, scope)).filter((x) => !s || [x.key, x.title, x.label, x.page, x.by, x.status, x.customer, x.customerRef, x.foundIn, x.fixVersion, x.assignee, x.severityLabel, x.priorityLabel].join(' ').toLowerCase().indexOf(s) !== -1) };
      return shownKept.v;
    }
    // ── the table: every issue with its columns, in an order ──
    tableRows(list, q, f, sortKey, scope) {
      const k = (list || []).map((x) => x.id + x.status + x.updatedAt).join(',') + '|' + q + '|' + f + '|' + sortKey + '|' + scope;
      if (tableKept.k === k) return tableKept.v;
      const g = { open: ['new', 'written', 'analyzed', 'triaged', 'needs-info', 'awaiting-approval', 'approved', 'rejected'], approval: ['awaiting-approval'], review: ['approved', 'in-review', 'verified'], closed: ['closed'] };
      const s = String(q || '').trim().toLowerCase();
      const rank = (v) => (RANK[v] !== undefined ? RANK[v] : 9);
      const by = { severity: (a, b) => rank(a.severity) - rank(b.severity), priority: (a, b) => rank(a.priority) - rank(b.priority), raised: (a, b) => String(b.raisedOn).localeCompare(String(a.raisedOn)),
        due: (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'), updated: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) }[sortKey] || ((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      tableKept = { k: k, v: (list || []).filter((x) => inScope(x, scope)).filter((x) => (f === 'all' || !f || (g[f] || []).indexOf(x.status) !== -1)
        && (!s || [x.key, x.title, x.label, x.customer, x.customerRef, x.foundIn, x.fixVersion, x.assignee, x.reportedBy, x.severityLabel, x.priorityLabel, x.environment].join(' ').toLowerCase().indexOf(s) !== -1)).slice().sort(by) };
      return tableKept.v;
    }
    sorts() { return [['updated', 'Updated'], ['severity', 'Severity'], ['priority', 'Priority'], ['raised', 'Raised on'], ['due', 'Due date']].map((x) => ({ id: x[0], label: x[1] })); }
    layoutClass(cur, id) { return 'nx-is-lay' + (cur === id ? ' nx-is-lay--on' : ''); }
    // ── the defect record ──
    severities() { return SEV.map((x) => ({ id: x[0], short: x[1], label: x[1] + ' · ' + x[2], hint: x[3] })); }
    priorities() { return PRI.map((x) => ({ id: x[0], short: x[1], label: x[1] + ' · ' + x[2], hint: x[3] })); }
    envs() { return ENVS.map((e) => ({ id: e, label: e })); }
    resolutions() { return RES.map((x) => ({ id: x[0], label: x[1] })); }
    rootCauses() { return CAUSE.map((x) => ({ id: x[0], label: x[1] })); }
    commentKinds() { return CKIND.map((x) => ({ id: x[0], label: x[1], hint: x[2] })); }
    chipClass(cur, id) { return 'nx-chip nx-chip--sm' + (cur === id ? ' nx-chip--on' : ''); }
    sevClass(code) { return 'nx-is-sev nx-is-sev--' + (code || 'none'); }
    priClass(code) { return 'nx-is-pri nx-is-pri--' + (code || 'none'); }
    sevShort(code) { const s = SEV.filter((x) => x[0] === code)[0]; return s ? s[1] : '—'; }
    priShort(code) { const s = PRI.filter((x) => x[0] === code)[0]; return s ? s[1] : '—'; }
    aiChose(d, k) { return !!d && Array.isArray(d.ai) && d.ai.indexOf(k) !== -1; }
    dateText(d) { return dateText(d); }
    metaLine(x) {
      const d = (x && x.details) || {};
      return [x.page, 'raised by ' + (d.reportedBy || x.by || 'someone') + (d.raisedOn ? ' on ' + dateText(d.raisedOn) : ''), d.customer ? 'customer ' + d.customer + (d.customerRef ? ' (' + d.customerRef + ')' : '') : '',
        d.foundIn ? 'found in ' + d.foundIn + (d.environment ? ' on ' + d.environment : '') : (d.environment ? 'on ' + d.environment : '')].filter(Boolean).join(' · ');
    }
    // ── the train: each step clickable, its own fields ──
    trainClass(s, x, sv) { return 'nx-is-step nx-is-step--' + s.state + (panelOf(x, sv) === s.n || (s.n === 4 && panelOf(x, sv) === 5) || (s.n === 5 && panelOf(x, sv) === 4) ? ' nx-is-step--sel' : ''); }
    isPanel(x, sv, n) { const p = panelOf(x, sv); return n === 4 ? (p === 4 || p === 5) : p === n; }
    panelTitle(x, sv) { return ['Logged: the issue as raised, and its details', 'Written up: the issue, clearly', 'Analyzed: where it belongs, and the change', 'Approval', 'The fix: its branch, its tests, the pull request',
      'The fix: its branch, its tests, the pull request', 'Verified: the fix tried in SIT or UAT', 'Closed: its resolution'][panelOf(x, sv)] || ''; }
    notCurrent(x, sv) { return Number(sv) >= 0 && !!x && Number(sv) !== x.stage && !(Number(sv) === 4 && x.stage === 5); }
    /** What to do next, and the button that does it: after logging, the write-up; then the analysis; the approval (email);
     *  the agent; verifying; closing with its resolution. */
    nextOf(x, info, approver) {
      if (!x) return null;
      const st = x.status;
      const to = approver || (info && info.mail && info.mail.signedIn ? info.mail.account : '');
      const shared = !!x.shared;
      const N = (text, act, label, key, alt, altAct, altKey) => ({ text: text, act: act, label: label, key: key || '', alt: alt || '', altAct: altAct || '', altKey: altKey || '' });
      if (shared) return N('Logged on another PC: you can comment and change its details here; its steps are done on that PC.', 'go', 'Its details', '0');
      if (st === 'new') return N('Next: the AI writes it up — a title, the steps, expected and actual, and a severity and priority if you left them empty.', 'format', 'Write it up with AI');
      if (st === 'written') return N('Next: check the write-up (and its details), then the AI reads the page\'s code and the FDD and says where it belongs — with the exact change if it is a fix on this page.', 'analyze', 'Analyze with AI', '', 'Check the write-up', 'go', '1');
      if (st === 'analyzed' && x.verdict && x.verdict.code === 'fix-here' && x.fix && x.fix.status === 'proposed') {
        return N('Next: send the proposed change for approval' + (to ? ' — emailed to ' + to : '') + '. The approver sees the issue, the verdict, the exact change and its checks.', 'ask', 'Send for approval', '', 'See the change', 'go', '2');
      }
      if (st === 'analyzed') return N('Next: analyze it again (the proposal is not ready to approve).', 'analyze', 'Analyze again', '', 'See the analysis', 'go', '2');
      if (st === 'triaged') return N('The AI says: ' + (x.verdictLabel || 'not a fix on this page') + '. Close it with that resolution, or answer and analyze again.', 'go', 'Close it…', '7', 'See why', 'go', '2');
      if (st === 'needs-info') return N('The AI needs more: email them for the missing information (the AI drafts it from its questions), or answer here, then analyze again.', 'emailInfo', '✉ Email for more information', '', 'Analyze again', 'go', '2');
      if (st === 'awaiting-approval') return N('Waiting for approval' + (x.approval && x.approval.requested && x.approval.requested.email && x.approval.requested.email.sent ? ' — emailed to ' + x.approval.requested.email.to : '') + '. Approve it, or reject it with why.', 'approve', 'Approve', '', 'Reject…', 'go', '3');
      if (st === 'approved') return N('Approved. Next: the agent applies it on its own branch (fix/' + x.key + '), runs the tests, commits, pushes and makes the pull request.', 'apply', 'Apply change');
      if (st === 'in-review') return N('Next: review and merge the pull request, deploy the build, then verify the fix in SIT or UAT.', 'go', 'Verify the fix', '6', x.branch && x.branch.pr ? 'The fix and its pull request' : '', 'go', '4');
      if (st === 'verified') return N('Verified' + (x.verification && x.verification.env ? ' in ' + x.verification.env : '') + '. Next: close it with its resolution and the release it is fixed in.', 'go', 'Close it…', '7');
      if (st === 'rejected') return N('Rejected' + (x.approval && x.approval.decision && x.approval.decision.reason ? ': ' + x.approval.decision.reason : '') + '. Reopen it to rework it.', 'reopen', 'Reopen');
      if (st === 'closed') return N('Closed as ' + (x.resolutionLabel || 'done') + (x.resolution && x.resolution.fixedIn ? ' · fixed in ' + x.resolution.fixedIn : '') + (x.resolution && x.resolution.by ? ' · by ' + x.resolution.by : '') + '.', 'reopen', 'Reopen');
      return null;
    }
    nextClass(x) { return 'nx-is-next nx-is-next--' + (!x ? 'none' : x.status === 'closed' ? 'done' : x.status === 'rejected' || x.status === 'needs-info' ? 'warn' : 'go'); }
    resDefault(x) {
      if (!x) return 'fixed';
      if (['in-review', 'verified'].indexOf(x.status) !== -1) return x.kind === 'bug' ? 'fixed' : 'done';
      const v = x.verdict && x.verdict.code;
      return v === 'as-designed' ? 'as-designed' : v === 'out-of-scope' ? 'out-of-scope' : v === 'fix-elsewhere' ? 'moved' : v === 'needs-info' ? 'cannot-reproduce' : 'wont-fix';
    }
    /** The agent's steps: as it goes (or went), else its plan (each waiting). */
    agentSteps(agent) { return agent && agent.steps ? agent.steps : AGENT.map((a) => ({ key: a[0], label: a[1], state: 'pending', detail: '', seconds: 0 })); }
    agentStepClass(s) { return 'nx-is-ag nx-is-ag--' + (s.state || 'pending'); }
    agentMark(s) { return { done: '✓', failed: '✗', skipped: '–', pending: '' }[s.state] || ''; }
    agentTime(s) { return s.seconds && s.state !== 'pending' ? secs(s.seconds) : ''; }
    agentHead(agent, x) {
      if (!agent) return 'What the agent will do on fix/' + (x ? x.key : '') + ' — your own code folder is not touched';
      if (agent.running) return 'Working… ' + secs(agent.seconds || 0);
      return agent.okRun ? '✓ Done in ' + secs(agent.seconds || 0) : '✗ Stopped after ' + secs(agent.seconds || 0) + (agent.error ? ': ' + agent.error : '');
    }
    agentClass(agent) { return 'nx-is-agent' + (!agent ? ' nx-is-agent--plan' : agent.running ? ' nx-is-agent--run' : agent.okRun ? ' nx-is-agent--ok' : ' nx-is-agent--bad'); }
    showChange(x) { return !!x && !!x.fix && (x.fix.diff || []).length > 0 && ['awaiting-approval', 'approved'].indexOf(x.status) !== -1; }
    verificationText(v) { return !v ? '' : (v.passed ? '✓ Verified' : '✗ Verification failed') + (v.env ? ' in ' + v.env : '') + (v.build ? ' on ' + v.build : '') + ' by ' + (v.by || 'someone') + ' · ' + when(v.at); }
    rootText(r) { const c = CAUSE.filter((x) => x[0] === (r && r.rootCause))[0]; return c ? c[1] + (r.rootNotes ? ' — ' + r.rootNotes : '') : '—'; }
    // ── the discussion ──
    initials(n) { const p = String(n || '?').replace(/[._@-]+/g, ' ').trim().split(/\s+/); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); }
    commentClass(c) { return 'nx-is-cmt nx-is-cmt--' + (c.kind || 'comment'); }
    commentMeta(c) { return (c.kindLabel || 'Comment') + (c.stage ? ' · at ' + c.stage : '') + ' · ' + when(c.at); }
    commentEmail(c) { return !c.email ? '' : (c.email.sent ? (c.kind === 'email' ? '✉ Sent to ' : '✉ Emailed to ') + c.email.to + (c.email.cc ? ' · cc ' + c.email.cc : '') : '✉ Not emailed: ' + c.email.error); }
    /** The Notify list as typed, each address checked (a wrong one shown in red). */
    emailChips(text) { return String(text || '').split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean).slice(0, 30).map((e, i) => ({ key: i + e, e: e, ok: EMAIL_RE.test(e) })); }
    mailClass(m) { return 'nx-is-mail' + (m.ok ? '' : ' nx-is-mail--bad'); }
    // ── the page in Application pages: its screenshots and technical sheet (the Analyzed step) ──
    pageShots(sheet, base) {
      const l = (sheet && sheet.screenshots) || [];
      return l.slice().reverse().slice(0, 6).map((x, i) => ({ key: x.file || String(i), url: PC.shotUrl(base, x), caption: (x.caption || (x.source === 'capture' ? 'Captured' : 'Uploaded')) + (x.at ? ' · ' + when(x.at) : ''), first: i === 0 }));
    }
    pageFacts(sheet) {
      const f = sheet && sheet.facts;
      if (!f) return [];
      const n = (a) => (a || []).length;
      return [['REST calls', n(f.integrations && f.integrations.rest)], ['BI reports', n(f.integrations && f.integrations.reports)], ['action chains', n(f.logic && f.logic.chains)], ['rules modules', n(f.logic && f.logic.modules)],
        ['actions', n(f.features && f.features.actions)], ['fields', n(f.features && f.features.fields)], ['columns', n(f.features && f.features.columns)]].filter((x) => x[1] > 0).map((x) => ({ key: x[0], n: x[1], label: x[0] }));
    }
    pageList(sheet, kind) {
      const f = (sheet && sheet.facts) || {};
      const l = kind === 'rest' ? ((f.integrations || {}).rest || []).map((r) => (r.method || '?') + ' ' + r.endpoint) : kind === 'reports' ? ((f.integrations || {}).reports || [])
        : kind === 'chains' ? ((f.logic || {}).chains || []).map((c) => c.name) : kind === 'sections' ? ((f.features || {}).sections || []) : [];
      return l.length > 8 ? l.slice(0, 8).concat(['+ ' + (l.length - 8) + ' more']) : l;
    }
    pageSheetText(sheet) {
      if (!sheet) return 'No technical sheet could be read for this page.';
      return (sheet.saved ? 'Its technical sheet: built ' + when(sheet.at) + (sheet.by ? ' by ' + sheet.by : '') : 'Not built into a sheet yet: these facts are read from its code now')
        + (sheet.codeChanged ? ' · ⚠ its code changed since' : '') + (sheet.facts && sheet.facts.route && sheet.facts.route.url ? ' · opens at ' + sheet.facts.route.url : '');
    }
    pageBuildText(x) {
      const d = (x && x.details) || {};
      return d.foundIn ? 'Found in ' + d.foundIn + (d.environment ? ' on ' + d.environment : '') + (d.fixVersion ? ' · to be fixed in ' + d.fixVersion : '') : (d.environment ? 'Seen on ' + d.environment : 'Which build or release it was found in is not set (its details, on Logged).');
    }
    pageAi(sheet) { const t = sheet && sheet.ai && sheet.ai.text ? String(sheet.ai.text) : ''; return t ? t.replace(/[#*`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 420) + (t.length > 420 ? '…' : '') : ''; }
    composerHint(k) { const c = CKIND.filter((x) => x[0] === k)[0]; return c ? c[2] : ''; }
    statusText(s) { return STATUS[s] || s; }
    statusClass(s) { return 'nx-is-st nx-is-st--' + (s || 'new'); }
    verdictClass(v) { return 'nx-is-verdict nx-is-verdict--' + (v || 'none'); }
    when(at) { return when(at); }
    rowMeta(x) { return [x.label, x.customer, x.foundIn ? 'in ' + x.foundIn : '', x.assignee ? '→ ' + x.assignee : '', when(x.updatedAt)].filter(Boolean).join(' · ') + (x.comments ? ' · 💬 ' + x.comments : '') + (x.shared ? ' · from another PC' : ''); }
    stepClass(s) { return 'nx-is-step nx-is-step--' + s.state; }
    // the page picker: only the pages of the build chosen; with nothing typed, its pages to browse (by flow, then name)
    pagesShown(pages, q, app) {
      if (!app) return [];
      const s = String(q || '').trim().toLowerCase();
      const mine = (pages || []).filter((p) => p.app === app || String(p.id).split('/')[0] === app);
      const hit = s ? mine.filter((p) => [p.label, p.id, p.flow, p.page].join(' ').toLowerCase().indexOf(s) !== -1) : mine.slice().sort((a, b) => (a.flow + a.label).localeCompare(b.flow + b.label));
      return hit.slice(0, s ? 20 : 60);
    }
    pagesCount(pages, app) { return (pages || []).filter((p) => p.app === app || String(p.id).split('/')[0] === app).length; }
    pageOf(pages, id) { return (pages || []).filter((p) => p.id === id)[0] || null; }
    pageText(p) { return p ? p.appName + ' · ' + (p.flow ? p.flow + '/' : '') + p.page : ''; }
    kinds() { return [{ id: 'bug', label: 'Bug' }, { id: 'enhancement', label: 'Enhancement' }, { id: 'change', label: 'Change' }]; }
    // the issue
    title(x) { return x ? (x.formatted && x.formatted.title) || x.title : ''; }
    canEdit(x) { return !!x && !x.shared && ['new', 'written', 'analyzed', 'triaged', 'needs-info', 'rejected'].indexOf(x.status) !== -1; }
    canDetails(x) { return !!x; }
    canAnalyze(x) { return !!x && !x.shared && ['new', 'written', 'analyzed', 'triaged', 'needs-info', 'rejected'].indexOf(x.status) !== -1; }
    inFilter(st, f) {
      const g = { open: ['new', 'written', 'analyzed', 'triaged', 'needs-info', 'awaiting-approval', 'approved', 'rejected'], approval: ['awaiting-approval'], review: ['approved', 'in-review', 'verified'], closed: ['closed'] };
      return f === 'all' || !f || (g[f] || []).indexOf(st) !== -1;
    }
    approvalShown(x) { return !!x && (['awaiting-approval', 'approved', 'rejected', 'in-review', 'closed'].indexOf(x.status) !== -1 || (x.status === 'analyzed' && !!x.verdict && x.verdict.code === 'fix-here' && !!x.fix && x.fix.status === 'proposed')); }
    notHere(x) { return !!x && (x.status === 'triaged' || x.status === 'needs-info'); }
    canAsk(x) { return !!x && !x.shared && x.status === 'analyzed' && x.verdict && x.verdict.code === 'fix-here' && !!x.fix && x.fix.status === 'proposed'; }
    stepsText(f) { return ((f && f.steps) || []).join('\n'); }
    indexed(list) { return (list || []).map((x, i) => Object.assign({ i: String(i), n: String(i + 1) }, x)); }
    img(x, n) { return IC.imgUrl(x, n); }
    doc(md) {
      return '<!doctype html><meta charset="utf-8"><style>body{font:14px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#161513;margin:0;padding:14px}'
        + 'h2,h3,h4{color:#00688c;margin:16px 0 6px;font-size:15px;font-weight:700}h2:first-child,h3:first-child{margin-top:0}ul,ol{margin:0 0 12px;padding-left:20px}li{margin-bottom:5px}p{margin:0 0 10px}'
        + 'code{background:#eef2f4;padding:1px 5px;border-radius:4px;font-size:12px}</style>' + SA.renderHtml(md || '');
    }
    /** Why: the verdict's text without its own words at the start (shown as the heading). */
    verdictText(v) {
      if (!v || !v.text) return '';
      return v.text.replace(/^[-*\s]*(\*\*)?\s*(fix (it )?on this page|fix here|fix elsewhere|works as designed|out of scope|needs? (more )?information)\s*(\*\*)?\s*[—–:.-]*\s*/i, '').replace(/\s*\n\s*/g, ' ').trim();
    }
    fixLine(t) { return 'nx-fx-l nx-fx-l--' + (t === '+' ? 'add' : t === '-' ? 'del' : 'ctx'); }
    fixSign(t) { return t === ' ' ? '' : (t === '-' ? '−' : t); }
    checkMark(c) { return c.ok ? '✓' : (c.warn ? '⚠' : (c.already ? '•' : '✗')); }
    checkClass(c) { return 'nx-fx-check ' + (c.ok ? 'nx-fx-check--ok' : (c.warn ? 'nx-fx-check--warn' : (c.already ? 'nx-fx-check--old' : 'nx-fx-check--bad'))); }
    stats(f) { const d = (f && f.diff) || []; return d.length + ' file' + (d.length === 1 ? '' : 's') + ' · +' + d.reduce((n, x) => n + x.added, 0) + ' −' + d.reduce((n, x) => n + x.removed, 0); }
    unitText(u) { return u.ok ? '✓ ' + u.passed + ' passed' : (u.newFailures.length ? '✗ ' + u.newFailures.length + ' new failure(s)' : '• ' + u.failed + ' failing, as before the fix'); }
    emailText(x) {
      const e = x && x.approval && x.approval.requested && x.approval.requested.email;
      if (!e) return '';
      return e.sent ? 'Approval email sent to ' + e.to + ' (code ' + x.approval.requested.code + '). Approving by replying to it comes with Mail.Read; approve here meanwhile.' : (e.error || '');
    }
    eventText(e) { return (e.by ? e.by + ' · ' : '') + when(e.at); }
    imgSize(x) { return (x.w ? x.w + '×' + x.h + ' · ' : '') + Math.max(1, Math.round((x.size || 0) / 1024)) + ' KB'; }
  }
  return PageModule;
});
