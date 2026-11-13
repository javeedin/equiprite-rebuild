'use strict';
/**
 * Issues (Build.Rite): an issue logged against a page goes from what someone wrote to a reviewed fix on a branch.
 *
 *   logged → written up (the AI) → analyzed (against the page's code and the FDD: a verdict, and for a fix on this page
 *   the exact change, checked) → awaiting approval (in the app, and an approval email from Microsoft 365) → approved →
 *   the agent applies it on a branch of its own (fix/<KEY>: the issue's number in the code's comments and the commit),
 *   tests it, pushes it and makes the pull request → verified (tested in SIT/UAT: passed, or back to be fixed again) →
 *   closed with its resolution (fixed, works as designed, duplicate, …), root cause and the release it is fixed in. Not a
 *   fix on this page: triaged (fix elsewhere, works as designed, out of scope) or needs information.
 *
 * Like a software company's defect record, each issue has its details — type, severity, priority, the environment and
 * build/release it was found in, the fix version, the customer and their ticket, who raised it and when, the reporter's
 * email, the assignee, a due date — and a discussion: comments, responses to the customer (emailed to them when asked)
 * and internal notes, by anyone; the copies of an issue on several PCs are merged (mergeIssue), never overwritten.
 *
 * Jira stays the record: an issue logged here can be created there (and one there brought here), and each step is a
 * comment on it. Each issue is kept here (issues.json) and, when there is one, on the app's data branch
 * (issues/<id>.json, lib/dataBranch.js) so everyone sees the same list. Self-approval for now (anyone may approve);
 * approval by email reply comes with Mail.Read.
 *
 *   open({ file, dir, ai, fix, mail, jira, fdd, data, pages, now, log, project }) → store   (pages: lib/pages.js, for the page's screenshot)
 *     info()  list({ q, status })  get(id)
 *     create({ page, text, kind, images, by, toJira, jiraKey })   format(id, { by })   update(id, fields, { by })
 *     toJira(id, { by })   analyze(id, { refine, by })   ask(id, { email, to, by })   approve(id, { by, via })
 *     reject(id, { by, reason })   apply(id, { by })   verify(id, { by, passed, env, build, notes })
 *     close(id, { by, note, resolution, rootCause, rootNotes, fixedIn })   reopen(id, { by })   img(id, n)
 *     details(id, fields, { by })   comment(id, { text, kind, email, to, by })   settings()   setSettings({ project })
 *     email(id, { to, cc, subject, body, by })   draft(id, { purpose, by })
 *     sandbox(id, { act: make | status | run | shots | tests | remove, which, diff, by })   progress(id, kind)
 *
 * The sandbox: before approval, the proposed fix is tried in a copy of the code on this PC (codeFix.makeSandbox: a git
 * worktree on fix/<KEY> in the data folder's sandboxes/, the fix written, the app built and served on a port of its
 * own): run it beside the app as it is, screenshots before and after, its tests. Apply commits and pushes from it (only
 * the change approved); closing the issue deletes it. Kept on this PC only (issue-sandboxes.json), never shared.
 *
 * Its Notify list (details.notify: the email of everyone to keep informed) gets an email each time its status changes
 * (not the AI's write-up straight after logging); a follow-up email (asking for more information, a status update…) can
 * be written here — or drafted by the AI from its questions and the discussion — and sent to them; it is kept in the
 * discussion.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const gitPaths = require('./gitPaths');

const KEEP = 500;
const STEPS = ['Logged', 'Written up', 'Analyzed', 'Approval', 'Applied', 'Pull request', 'Verified', 'Closed'];
const STAGE = { new: 0, written: 1, analyzed: 2, triaged: 2, 'needs-info': 2, 'awaiting-approval': 3, approved: 3, rejected: 3, 'in-review': 5, verified: 6, closed: 7 };
// the defect record's choices (the screen shows the same: resources/js/issueFields.js)
const SEVERITY = { critical: 'S1 · Critical', major: 'S2 · Major', minor: 'S3 · Minor', trivial: 'S4 · Trivial' };
const PRIORITY = { p1: 'P1 · Urgent', p2: 'P2 · High', p3: 'P3 · Medium', p4: 'P4 · Low' };
const ENVS = ['DEV', 'SIT', 'UAT', 'PROD'];
const RESOLUTION = { fixed: 'Fixed', done: 'Done', 'as-designed': 'Works as designed', 'out-of-scope': 'Out of scope', moved: 'Fixed elsewhere', duplicate: 'Duplicate',
  'cannot-reproduce': 'Cannot reproduce', 'wont-fix': 'Won\'t fix' };
const ROOT_CAUSE = { code: 'Code defect', config: 'Configuration', data: 'Data', requirement: 'Requirement gap', environment: 'Environment', integration: 'Integration (Fusion, OIC, BI Publisher)',
  user: 'User error / training', none: 'None' };
// what the agent does when Apply change is pressed, in order (codeFix.applyToBranch says each as it goes)
const AGENT_STEPS = [['fetch', 'Get the latest code'], ['branch', 'Make its own branch'], ['check', 'Check the change still fits the code'], ['before', 'Run the related tests, before the change'],
  ['write', 'Write the change'], ['after', 'Run the tests again, with the change'], ['commit', 'Commit it'], ['push', 'Push the branch'], ['pr', 'The pull request']];
// what making the sandbox does (codeFix.makeSandbox says each as it goes): the fix tried first, in a copy of the code
const SANDBOX_STEPS = [['fetch', 'Get the latest code'], ['copy', 'Make the sandbox: a copy of the code'], ['check', 'Check the fix fits the code'], ['before', 'Run the related tests, before the fix'],
  ['write', 'Write the fix into the sandbox'], ['build', 'Build the app in the sandbox']];
const COMMENT_KIND = { comment: 'Comment', response: 'Response to the customer', internal: 'Internal note', email: 'Email' };
const STATUS_LABEL = { new: 'Logged', written: 'Written up', analyzed: 'Analyzed', triaged: 'Triaged', 'needs-info': 'Needs information', 'awaiting-approval': 'Waiting for approval',
  approved: 'Approved', rejected: 'Rejected', 'in-review': 'Pull request', verified: 'Verified', closed: 'Closed' };
const DETAIL_LABEL = { severity: 'Severity', priority: 'Priority', environment: 'Environment', foundIn: 'Found in', fixVersion: 'Fix version', customer: 'Customer', customerRef: 'Customer ticket',
  reportedBy: 'Raised by', reporterEmail: 'Reporter email', raisedOn: 'Raised on', assignee: 'Assignee', dueDate: 'Due date', notify: 'Notify' };
const VERDICT_LABEL = { 'fix-here': 'Fix on this page', 'fix-elsewhere': 'Fix elsewhere', 'as-designed': 'Works as designed', 'out-of-scope': 'Out of scope', 'needs-info': 'Needs information' };

const FORMAT_SYSTEM = [
  'You write up software issues for the team building EquipRite, an Oracle Visual Builder (VBCS) application on Oracle Fusion.',
  'From what the person wrote (and any screenshots), write the issue clearly, keeping their meaning. Do not invent facts:',
  'leave a field empty when it is not known, and say what is missing under questions. Plain English, short.',
  'Answer ONLY with JSON, nothing else:',
  '{"title": "a one-line title (max 90 characters)", "summary": "two or three sentences", "steps": ["step to reproduce", "…"],',
  ' "expected": "what should happen", "actual": "what happens", "impact": "who is affected and how badly",',
  ' "kind": "bug | enhancement | change", "questions": ["what is missing", "…"],',
  ' "severity": "critical | major | minor | trivial", "priority": "p1 | p2 | p3 | p4", "why": "one sentence: why that severity and priority"}',
  'Severity is how bad it is: critical = the system or a main flow is down, data is lost or wrong, no workaround; major = a main',
  'function does not work and the workaround is hard; minor = it works with a workaround or affects few; trivial = cosmetic, text.',
  'Priority is how soon to fix it: p1 = now (blocks production or a release); p2 = in the next build; p3 = planned; p4 = when there is time.',
].join('\n');

function str(v) { return v == null ? '' : String(v); }
const sha = (t) => crypto.createHash('sha1').update(str(t)).digest('hex').slice(0, 12);
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
/** The first {…} of an answer, parsed. */
function jsonOf(text) {
  const t = str(text);
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i === -1 || j <= i) return null;
  try { return JSON.parse(t.slice(i, j + 1)); } catch (e) { return null; }
}
/** The issue as text, for the analysis and for Jira. */
function issueText(x) {
  const f = x.formatted || {};
  const L = [];
  L.push((f.title || x.title || '').trim());
  if (f.summary) L.push('', f.summary);
  if ((f.steps || []).length) L.push('', 'Steps to reproduce:', f.steps.map((s, i) => (i + 1) + '. ' + s).join('\n'));
  if (f.expected) L.push('', 'Expected: ' + f.expected);
  if (f.actual) L.push('Actual: ' + f.actual);
  if (f.impact) L.push('Impact: ' + f.impact);
  if (x.text && x.text.trim() && x.text.trim() !== (f.summary || '').trim()) L.push('', 'As written by ' + (x.by || 'the person') + ': ' + x.text.trim());
  return L.join('\n').trim();
}
function jiraWiki(x) {
  const f = x.formatted || {};
  const L = [];
  if (f.summary) L.push(f.summary, '');
  if ((f.steps || []).length) L.push('*Steps to reproduce*', f.steps.map((s) => '# ' + s).join('\n'), '');
  if (f.expected) L.push('*Expected:* ' + f.expected);
  if (f.actual) L.push('*Actual:* ' + f.actual);
  if (f.impact) L.push('*Impact:* ' + f.impact);
  const d = x.details || {};
  const rows = [['Type', x.kind], ['Severity', SEVERITY[d.severity]], ['Priority', PRIORITY[d.priority]], ['Environment', d.environment], ['Found in', d.foundIn], ['Fix version', d.fixVersion],
    ['Customer', d.customer], ['Customer ticket', d.customerRef], ['Raised by', d.reportedBy], ['Raised on', d.raisedOn], ['Assignee', d.assignee], ['Due date', d.dueDate]].filter((r) => r[1]);
  if (rows.length) L.push('', rows.map((r) => '||' + r[0] + '|' + str(r[1]).replace(/\|/g, '/') + '|').join('\n'));
  L.push('', '*Page:* ' + x.label + ' ({{' + x.page + '}})', '_Logged in Build.Rite by ' + (x.by || 'someone') + '._');
  if (x.text) L.push('', '{quote}' + x.text.slice(0, 4000) + '{quote}');
  return L.join('\n');
}
const esc = (s) => str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(str(v));
const isEmail = (v) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(str(v));
/** Email addresses typed as a list ("a@x.com, b@y.com; …" or one per line, or an array): checked, lower-cased, once each. */
function emailsOf(v) {
  const all = (Array.isArray(v) ? v : str(v).split(/[\s,;]+/)).map((e) => str(e).trim().replace(/^<|>$/g, '')).filter(Boolean);
  const ok = all.filter(isEmail).map((e) => e.toLowerCase()).filter((e, i, a) => a.indexOf(e) === i).slice(0, 30);
  return { ok, bad: all.filter((e) => !isEmail(e)) };
}

/** An issue's details, cleaned: each choice one of its list, texts trimmed and capped, dates YYYY-MM-DD, an email an email.
 *  What is not given keeps its value (prev); what is changed is listed ("Severity: S3 · Minor → S2 · Major"). */
function cleanDetails(d, prev) {
  const p = prev || {};
  const g = d || {};
  const text = (k, max) => (g[k] === undefined ? str(p[k]) : str(g[k]).trim().slice(0, max));
  const pick = (k, ok) => (g[k] === undefined ? str(p[k]) : (ok(str(g[k]).trim()) ? str(g[k]).trim() : ''));
  const out = {
    severity: pick('severity', (v) => !!SEVERITY[v]), priority: pick('priority', (v) => !!PRIORITY[v]), environment: pick('environment', (v) => ENVS.indexOf(v) !== -1),
    foundIn: text('foundIn', 60), fixVersion: text('fixVersion', 60), customer: text('customer', 120), customerRef: text('customerRef', 60), reportedBy: text('reportedBy', 120),
    reporterEmail: pick('reporterEmail', isEmail), raisedOn: pick('raisedOn', isDate), assignee: text('assignee', 120), dueDate: pick('dueDate', isDate),
    notify: g.notify === undefined ? (Array.isArray(p.notify) ? p.notify.slice() : []) : emailsOf(g.notify).ok,
    ai: (Array.isArray(p.ai) ? p.ai : []).filter((k) => g[k] === undefined), // the fields the AI chose (until someone sets them)
  };
  out.aiWhy = out.ai.length ? str(p.aiWhy).slice(0, 300) : '';
  const show = (k, v) => (k === 'severity' ? SEVERITY[v] : k === 'priority' ? PRIORITY[v] : Array.isArray(v) ? v.join(', ') : v) || '—';
  const changed = Object.keys(DETAIL_LABEL).filter((k) => str(out[k]) !== str(p[k] === undefined && k === 'notify' ? [] : p[k])).map((k) => DETAIL_LABEL[k] + ': ' + show(k, p[k]) + ' → ' + show(k, out[k]));
  return { details: out, changed, bad: g.notify === undefined ? [] : emailsOf(g.notify).bad };
}

/** Two copies of one issue (this PC's, and another's from the data branch) as one: the later one's state, and every comment
 *  and step of both — so two people answering at once both keep their words. */
function mergeIssue(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = Object.assign({}, str(a.updatedAt) >= str(b.updatedAt) ? a : b);
  const seen = {};
  out.comments = (a.comments || []).concat(b.comments || []).filter((c) => c && c.id && !seen[c.id] && (seen[c.id] = true)).sort((x, y) => str(x.at).localeCompare(str(y.at)));
  const evs = {};
  out.events = (a.events || []).concat(b.events || []).filter((e) => { const k = str(e.at) + '|' + str(e.what) + '|' + str(e.by); if (evs[k]) return false; evs[k] = true; return true; })
    .sort((x, y) => str(x.at).localeCompare(str(y.at)));
  return out;
}

function open(opts) {
  const o = opts || {};
  const file = o.file || '';
  const dir = o.dir || (file ? path.join(path.dirname(file), 'issues') : '');
  const now = o.now || (() => new Date());
  const log = typeof o.log === 'function' ? o.log : () => {};
  let mem = { issues: [], settings: {} };
  const load = () => { if (!file) return mem; try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return { issues: Array.isArray(j.issues) ? j.issues : [], settings: j.settings || {} }; } catch (e) { return { issues: [], settings: {} }; } };
  const save = (d) => { mem = d; if (!file) return; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(d, null, 1)); };
  const all = () => load().issues;
  /** An issue as everyone has it: this PC's copy merged with the data branch's (another PC's comments and steps kept). */
  const byId = (id) => {
    const mine = all().filter((x) => x.id === str(id))[0] || null;
    const theirs = sharedAll().filter((x) => x.id === str(id))[0] || null;
    if (!mine && !theirs) return null;
    const m = mergeIssue(mine, theirs);
    const x = Object.assign({}, m);
    delete x.shared;
    return x;
  };
  const project = () => load().settings.project || o.project || 'EQP';
  const ok = (issue, extra) => Object.assign({ ok: true, issue: view(issue) }, extra || {});
  const no = (error, extra) => Object.assign({ ok: false, error: error }, extra || {});

  function ev(x, what, by, detail) {
    x.events = (x.events || []).concat([{ at: now().toISOString(), what: what, by: str(by), detail: str(detail).slice(0, 500) }]);
    x.updatedAt = now().toISOString();
  }
  function put(x, quiet) {
    const d = load();
    const before = d.issues.filter((y) => y.id === x.id)[0] || sharedAll().filter((y) => y.id === x.id)[0] || null;
    d.issues = [x].concat(d.issues.filter((y) => y.id !== x.id)).slice(0, KEEP);
    save(d);
    publish(x);
    const was = before ? before.status : '';
    // the email says this change, to the list as it is now (taken now: it is sent a moment later)
    if (!quiet && was !== x.status && !(was === 'new' && x.status === 'written')) notifyStatus(JSON.parse(JSON.stringify(x)), was);
    return x;
  }

  // ── its Notify list: an email at each change of status ──
  let notes = Promise.resolve();
  const mailReady = () => { const st = o.mail && typeof o.mail.status === 'function' ? (() => { try { return o.mail.status(); } catch (e) { return {}; } })() : {}; return !!(o.mail && st.signedIn); };
  function statusHtml(x, was) {
    const f = x.formatted || {};
    const d = x.details || {};
    const rows = [['Status', (was ? (STATUS_LABEL[was] || was) + ' → ' : '') + (STATUS_LABEL[x.status] || x.status)], ['Verdict', x.verdict ? VERDICT_LABEL[x.verdict.code] : ''],
      ['Resolution', x.resolution ? RESOLUTION[x.resolution.code] + (x.resolution.fixedIn ? ' · fixed in ' + x.resolution.fixedIn : '') : ''],
      ['Severity', SEVERITY[d.severity]], ['Priority', PRIORITY[d.priority]], ['Customer', d.customer ? d.customer + (d.customerRef ? ' (' + d.customerRef + ')' : '') : ''],
      ['Found in', d.foundIn ? d.foundIn + (d.environment ? ' on ' + d.environment : '') : ''], ['Fix version', d.fixVersion], ['Assignee', d.assignee], ['Page', x.label]].filter((r) => r[1]);
    const last = (x.events || []).slice(-1)[0];
    return '<div style="font:14px/1.5 Segoe UI,Arial,sans-serif;color:#16212c;max-width:760px"><div style="background:#2c5266;color:#fff;padding:12px 16px;border-radius:8px 8px 0 0">'
      + '<div style="font-size:12px;opacity:.8">' + esc(keyOf(x)) + ' · STATUS UPDATE</div><div style="font-size:18px;font-weight:700">' + esc(f.title || x.title) + '</div></div>'
      + '<div style="border:1px solid #d4dce4;border-top:0;padding:14px 16px;border-radius:0 0 8px 8px"><table style="border-collapse:collapse;font-size:13px">'
      + rows.map((r) => '<tr><td style="padding:3px 14px 3px 0;color:#5a6876;font-weight:600">' + esc(r[0]) + '</td><td style="padding:3px 0">' + esc(r[1]) + '</td></tr>').join('') + '</table>'
      + (last && last.detail ? '<p style="margin:12px 0 0">' + esc(last.what) + (last.by ? ' by ' + esc(last.by) : '') + ': ' + esc(last.detail) + '</p>' : '')
      + '<p style="color:#6b7886;font-size:12px;margin-top:16px">You are on the Notify list of ' + esc(keyOf(x)) + ' in Build.Rite. Reply to answer.</p></div></div>';
  }
  function notifyStatus(snap, was) {
    const to = snap.details && Array.isArray(snap.details.notify) ? snap.details.notify : [];
    if (!to.length) return notes;
    notes = notes.then(async () => {
      let what;
      if (!mailReady()) what = 'not emailed (not signed in to Microsoft 365)';
      else {
        const r = await o.mail.sendMail({ to: to.join(';'), subject: '[' + keyOf(snap) + '] ' + (STATUS_LABEL[snap.status] || snap.status) + ' · ' + ((snap.formatted && snap.formatted.title) || snap.title), html: statusHtml(snap, was) });
        what = r && r.ok ? 'emailed to ' + to.join(', ') : 'not emailed: ' + ((r && r.error) || 'not sent');
      }
      const x = byId(snap.id);
      if (!x) return;
      ev(x, 'status sent to the Notify list', 'Build.Rite', (STATUS_LABEL[snap.status] || snap.status) + ' · ' + what);
      put(x, true);
    }).catch((e) => log('issues: notify: ' + e.message));
    return notes;
  }
  /** What the screen shows: the issue, its fix (the analysis, the change, the tests), its stage. */
  function view(x) {
    const v = Object.assign({}, x);
    v.stage = STAGE[x.status] != null ? STAGE[x.status] : 0;
    v.steps = STEPS.map((t, i) => ({ n: i, label: t, state: i < v.stage ? 'done' : (i === v.stage ? (x.status === 'closed' ? 'done' : 'now') : 'next') }));
    v.verdictLabel = x.verdict ? VERDICT_LABEL[x.verdict.code] || '' : '';
    v.details = Object.assign(cleanDetails({}, x.details).details, { severityLabel: SEVERITY[(x.details || {}).severity] || '', priorityLabel: PRIORITY[(x.details || {}).priority] || '' });
    v.comments = (x.comments || []).map((c) => Object.assign({}, c, { kindLabel: COMMENT_KIND[c.kind] || 'Comment' }));
    v.resolutionLabel = x.resolution ? RESOLUTION[x.resolution.code] || '' : '';
    if (x.fixId && o.fix) { const g = o.fix.get(x.fixId); v.fix = g && g.ok ? g.fix : null; }
    v.sandbox = sbView(x);
    return v;
  }

  // ── shared with everyone: the data branch (issues/<id>.json) ──
  const shared = o.data && o.data.ok ? o.data : null;
  const repo = shared ? gitPaths.create({ root: shared.dir, paths: ['issues'], git: o.git ? (args) => o.git(shared.dir, args) : undefined, gitPath: o.gitPath,
    message: 'Issues: update', sync: { resolve: shared.resolve, after: shared.merged } }) : null;
  let pub = Promise.resolve();
  function publish(x) {
    if (!repo) return pub;
    const rec = Object.assign({}, x, { images: (x.images || []).map((im) => ({ n: im.n, name: im.name })) });
    pub = pub.then(async () => {
      try {
        fs.mkdirSync(path.join(shared.dir, 'issues'), { recursive: true });
        fs.writeFileSync(path.join(shared.dir, 'issues', x.id + '.json'), JSON.stringify(rec, null, 1) + '\n');
        const r = await repo.save({ message: 'Issues: ' + x.key + ' ' + x.status + ' — ' + str((x.formatted && x.formatted.title) || x.title).slice(0, 60) });
        if (!r.ok) log('issues: not pushed (' + r.error + ')');
      } catch (e) { log('issues: ' + e.message); }
    });
    return pub;
  }
  function sharedAll() {
    if (!shared) return [];
    try { return fs.readdirSync(path.join(shared.dir, 'issues')).filter((n) => /^is[a-z0-9]+\.json$/.test(n)).map((n) => { try { return Object.assign(JSON.parse(fs.readFileSync(path.join(shared.dir, 'issues', n), 'utf8')), { shared: true }); } catch (e) { return null; } }).filter(Boolean); } catch (e) { return []; }
  }

  // ── Jira ──
  async function jira(method, p, body) {
    const a = o.jira && typeof o.jira.auth === 'function' ? o.jira.auth() : null;
    if (!a || !a.site || !a.header) return { ok: false, error: 'Jira is not connected (Jira stories → Connect Jira).' };
    const doFetch = o.jira.fetch || (typeof fetch === 'function' ? fetch : null);
    try {
      const r = await doFetch(String(a.site).replace(/\/+$/, '') + p, { method: method, headers: { Authorization: a.header, Accept: 'application/json', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text();
      let j = null;
      try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
      if (r.ok) return { ok: true, body: j, site: String(a.site).replace(/\/+$/, '') };
      const why = j ? [].concat(j.errorMessages || [], Object.keys(j.errors || {}).map((k) => k + ': ' + j.errors[k])).join('; ') : '';
      const plain = { 401: 'Jira did not accept the login (HTTP 401): connect Jira again with a new API token (Jira stories → Connect Jira).',
        403: 'Jira refused (HTTP 403): the connected account (' + str(a.email || 'its email') + ') may not do this in project ' + project() + '. Ask the Jira admin for the "Create issues" (and "Add comments") permission there, or set the right project key below.',
        404: 'Jira has no such thing (HTTP 404): check the project key (' + project() + ') or the issue key.' }[r.status];
      return { ok: false, status: r.status, error: [plain, why].filter(Boolean).join(' ') || ('Jira answered HTTP ' + r.status) };
    } catch (e) { return { ok: false, error: 'Jira did not answer: ' + str(e && e.message) }; }
  }
  async function jiraComment(x, text) {
    if (!x.jira || !x.jira.key) return;
    const r = await jira('POST', '/rest/api/2/issue/' + encodeURIComponent(x.jira.key) + '/comment', { body: text + '\n\n_— Build.Rite_' });
    if (!r.ok) ev(x, 'Jira comment failed', 'Build.Rite', r.error);
  }

  // ── the FDD sections that match the issue (for "works as designed") ──
  function fddContext(x) {
    try {
      const t = o.fdd && typeof o.fdd.pick === 'function' ? o.fdd.pick({ summary: (x.formatted && x.formatted.title) || '', body: issueText(x) }) : '';
      return t ? 'FDD (the sections of the functional design that match this issue — quote them when the verdict is Works as designed or Out of scope)\n' + t : '';
    } catch (e) { return ''; }
  }

  const fixOf = (x) => (x.fixId && o.fix ? (o.fix.get(x.fixId) || {}).fix || null : null);
  const fingerprint = (fx) => (fx ? sha(JSON.stringify([fx.files, fx.hashes, (fx.diff || []).map((d) => d.hunks)])) : '');
  const keyOf = (x) => (x.jira && x.jira.key) || x.key;

  async function info() {
    const mail = o.mail && typeof o.mail.status === 'function' ? (() => { try { const s = o.mail.status(); return { signedIn: !!s.signedIn, account: s.account || '' }; } catch (e) { return { signedIn: false, account: '' }; } })() : { signedIn: false, account: '' };
    const ja = o.jira && typeof o.jira.auth === 'function' ? o.jira.auth() : null;
    return { ok: true, jira: { connected: !!(ja && ja.header), site: ja ? ja.site : '', project: project() }, mail: mail, shared: !!shared, branch: shared ? shared.branch : '',
      fix: o.fix ? await o.fix.info() : null, steps: STEPS, choices: { severity: SEVERITY, priority: PRIORITY, environments: ENVS, resolution: RESOLUTION, rootCause: ROOT_CAUSE, commentKind: COMMENT_KIND } };
  }
  function list(b) {
    b = b || {};
    const mine = all();
    const theirs = sharedAll();
    const rows = mine.map((m) => mergeIssue(m, theirs.filter((t) => t.id === m.id)[0] || null)).map((m) => Object.assign({}, m, { shared: false }))
      .concat(theirs.filter((x) => !mine.some((m) => m.id === x.id)));
    const words = str(b.q).toLowerCase().split(/\s+/).filter(Boolean);
    const groups = { open: ['new', 'written', 'analyzed', 'triaged', 'needs-info', 'awaiting-approval', 'approved', 'rejected'], approval: ['awaiting-approval'], review: ['approved', 'in-review', 'verified'], closed: ['closed'] };
    const out = rows.filter((x) => (!b.status || b.status === 'all' || (groups[b.status] || [b.status]).indexOf(x.status) !== -1)
      && (!words.length || words.every((w) => { const d = x.details || {}; return [x.key, x.jira && x.jira.key, x.title, x.formatted && x.formatted.title, x.label, x.page, x.by, x.status,
        d.customer, d.customerRef, d.foundIn, d.fixVersion, d.assignee, d.reportedBy, d.environment, SEVERITY[d.severity], PRIORITY[d.priority]].join(' ').toLowerCase().indexOf(w) !== -1; })))
      .map((x) => { const d = x.details || {}; return { id: x.id, key: keyOf(x), title: (x.formatted && x.formatted.title) || x.title, label: x.label, page: x.page, app: x.app || str(x.page).split('/')[0], status: x.status, kind: x.kind,
        verdict: x.verdict ? x.verdict.code : '', verdictLabel: x.verdict ? VERDICT_LABEL[x.verdict.code] || '' : '', by: x.by, at: x.at, updatedAt: x.updatedAt || x.at, jira: x.jira || null, shared: !!x.shared,
        severity: d.severity || '', severityLabel: SEVERITY[d.severity] || '', priority: d.priority || '', priorityLabel: PRIORITY[d.priority] || '', environment: d.environment || '',
        foundIn: d.foundIn || '', fixVersion: d.fixVersion || '', customer: d.customer || '', customerRef: d.customerRef || '', reportedBy: d.reportedBy || x.by || '',
        raisedOn: d.raisedOn || str(x.at).slice(0, 10), assignee: d.assignee || '', dueDate: d.dueDate || '', comments: (x.comments || []).length,
        resolution: x.resolution ? x.resolution.code : '', resolutionLabel: x.resolution ? RESOLUTION[x.resolution.code] || '' : '' }; });
    out.sort((a, c) => str(c.updatedAt).localeCompare(str(a.updatedAt)));
    const count = (st) => rows.filter((x) => (groups[st] || [st]).indexOf(x.status) !== -1).length;
    return { ok: true, issues: out, counts: { all: rows.length, open: count('open'), approval: count('approval'), review: count('review'), closed: count('closed') } };
  }

  async function create(b) {
    b = b || {};
    let text = str(b.text).trim();
    let jiraRef = null;
    if (b.jiraKey) {
      const k = str(b.jiraKey).trim().toUpperCase();
      if (!/^[A-Z][A-Z0-9]*-\d+$/.test(k)) return no('Give a Jira key like EQP-123.');
      const r = await jira('GET', '/rest/api/2/issue/' + encodeURIComponent(k) + '?fields=summary,description,issuetype,status', null);
      if (!r.ok) return no('Could not read ' + k + ' from Jira: ' + r.error);
      const fl = (r.body && r.body.fields) || {};
      text = [fl.summary, typeof fl.description === 'string' ? fl.description : '', text].filter(Boolean).join('\n\n');
      jiraRef = { key: k, url: r.site + '/browse/' + k, from: true };
    }
    if (!text) return no('Say what is wrong (or give its Jira key).');
    if (b.app !== undefined && !str(b.app)) return no('Choose the build first (Old, New, Next, Mobile or Future), then its page.');
    if (!b.page) return no('Choose the page the issue is on.');
    if (b.app && str(b.page).split('/')[0] !== str(b.app)) return no('That page is not in the build chosen: choose one of its own pages.');
    const facts = o.fix && o.fix.pageOf ? o.fix.pageOf(b.page) : null;
    const id = 'is' + now().getTime().toString(36) + crypto.randomBytes(2).toString('hex');
    const x = { id: id, key: jiraRef ? jiraRef.key : 'BR-' + now().getTime().toString(36).slice(-5).toUpperCase(), page: str(b.page), label: (facts && facts.label) || str(b.page),
      app: (facts && facts.app) || str(b.page).split('/')[0], kind: ['bug', 'enhancement', 'change'].indexOf(b.kind) !== -1 ? b.kind : 'bug', text: text, title: text.split('\n')[0].slice(0, 90),
      by: str(b.by), at: now().toISOString(), status: 'new', images: [], jira: jiraRef, events: [], comments: [],
      // what the form left empty takes its default: raised by the person logging it, today
      details: cleanDetails(Object.assign({ reportedBy: str(b.by), raisedOn: now().toISOString().slice(0, 10) },
        Object.keys(b.details || {}).reduce((g, k) => { if (str(b.details[k]).trim() !== '') g[k] = b.details[k]; return g; }, {})), {}).details };
    (Array.isArray(b.images) ? b.images : []).filter((im) => im && /^image\/(png|jpeg|webp|gif)$/.test(im.mime) && im.base64).slice(0, 6).forEach((im, i) => {
      if (!dir) return;
      const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[im.mime];
      const f = 'img-' + (i + 1) + '.' + ext;
      fs.mkdirSync(path.join(dir, id), { recursive: true });
      fs.writeFileSync(path.join(dir, id, f), Buffer.from(str(im.base64).replace(/^data:[^,]*,/, ''), 'base64'));
      x.images.push({ n: i + 1, name: str(im.name).slice(0, 80) || 'image', mime: im.mime, file: f });
    });
    ev(x, jiraRef ? 'brought from Jira' : 'logged', x.by, jiraRef ? jiraRef.key : x.title);
    put(x);
    return ok(x);
  }
  const imagesOf = (x) => (x.images || []).map((im) => { try { return { name: im.name, mime: im.mime, base64: fs.readFileSync(path.join(dir, x.id, im.file)).toString('base64') }; } catch (e) { return null; } }).filter(Boolean);
  function img(id, n) {
    const x = byId(id);
    if (x && /^sandbox-(before|after)$/.test(str(n))) {
      const r = sbGet(x.id), sh = r && r.shots && r.shots[str(n).slice(8)];
      const sp = sh && dir ? path.join(dir, x.id, sh.file) : '';
      return sp && fs.existsSync(sp) ? { ok: true, file: sp, mime: sh.mime } : no('No such image.');
    }
    const im = x && (x.images || []).filter((y) => String(y.n) === String(n))[0];
    const p = im && dir ? path.join(dir, x.id, im.file) : '';
    return p && fs.existsSync(p) ? { ok: true, file: p, mime: im.mime } : no('No such image.');
  }

  async function format(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (!o.ai || typeof o.ai.chat !== 'function') return no('No AI is set up: choose one in AI settings.');
    const r = await o.ai.chat({ system: FORMAT_SYSTEM, user: 'PAGE: ' + x.label + ' (' + x.page + ')\nKIND: ' + x.kind + '\n\nWHAT THEY WROTE:\n' + x.text, maxTokens: 2000, images: imagesOf(x) });
    if (!r || !r.ok) return no((r && r.error) || 'The AI did not answer.');
    const j = jsonOf(r.text);
    if (!j || !j.title) return no('The AI did not answer in the expected form: try again.');
    x.formatted = { title: str(j.title).slice(0, 120), summary: str(j.summary), steps: (Array.isArray(j.steps) ? j.steps : []).map(str).filter(Boolean).slice(0, 20),
      expected: str(j.expected), actual: str(j.actual), impact: str(j.impact), questions: (Array.isArray(j.questions) ? j.questions : []).map(str).filter(Boolean).slice(0, 8) };
    if (['bug', 'enhancement', 'change'].indexOf(j.kind) !== -1) x.kind = j.kind;
    // severity and priority: the AI's, where nobody set them (marked as the AI's until someone does)
    const d = Object.assign({ ai: [] }, x.details || {});
    const chose = [];
    if (!d.severity && SEVERITY[j.severity]) { d.severity = j.severity; chose.push('severity'); }
    if (!d.priority && PRIORITY[j.priority]) { d.priority = j.priority; chose.push('priority'); }
    d.ai = (d.ai || []).concat(chose).filter((k, i, a) => a.indexOf(k) === i);
    if (chose.length) d.aiWhy = str(j.why).slice(0, 300);
    x.details = d;
    x.status = x.status === 'new' ? 'written' : x.status;
    ev(x, 'written up', r.provider || 'AI', x.formatted.title + (chose.length ? ' · suggests ' + chose.map((k) => (k === 'severity' ? SEVERITY : PRIORITY)[d[k]]).join(', ') : ''));
    put(x);
    return ok(x);
  }
  function update(id, f, b) {
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (STAGE[x.status] >= 3 && x.status !== 'rejected') return no('It is with the approval already: reopen it to change it.');
    f = f || {};
    x.formatted = Object.assign({}, x.formatted || {}, {
      title: f.title != null ? str(f.title).slice(0, 120) : (x.formatted || {}).title, summary: f.summary != null ? str(f.summary) : (x.formatted || {}).summary,
      steps: f.steps != null ? (Array.isArray(f.steps) ? f.steps : str(f.steps).split('\n')).map((s) => str(s).replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean) : (x.formatted || {}).steps || [],
      expected: f.expected != null ? str(f.expected) : (x.formatted || {}).expected, actual: f.actual != null ? str(f.actual) : (x.formatted || {}).actual,
      impact: f.impact != null ? str(f.impact) : (x.formatted || {}).impact });
    if (f.page && f.page !== x.page) { const facts = o.fix && o.fix.pageOf ? o.fix.pageOf(f.page) : null; x.page = f.page; x.label = (facts && facts.label) || f.page; x.app = (facts && facts.app) || x.app; }
    if (x.status === 'new') x.status = 'written';
    ev(x, 'edited', (b && b.by) || '', '');
    put(x);
    return ok(x);
  }
  async function toJira(id, b) {
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (x.jira && x.jira.key) return ok(x, { already: true });
    const fields = { project: { key: project() }, summary: str((x.formatted && x.formatted.title) || x.title).slice(0, 250), description: jiraWiki(x) };
    let r = await jira('POST', '/rest/api/2/issue', { fields: Object.assign({}, fields, { issuetype: { name: x.kind === 'bug' ? 'Bug' : 'Task' } }) });
    if (!r.ok && /issuetype|issue type/i.test(r.error) && x.kind === 'bug') r = await jira('POST', '/rest/api/2/issue', { fields: Object.assign({}, fields, { issuetype: { name: 'Task' } }) });
    if (!r.ok) return no('Could not create it in Jira: ' + r.error);
    const k = r.body && r.body.key;
    x.jira = { key: k, url: r.site + '/browse/' + k };
    x.localKey = x.key; x.key = k;
    ev(x, 'created in Jira', (b && b.by) || '', k);
    put(x);
    return ok(x);
  }

  async function analyze(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (!o.fix) return no('Code analysis is not set up here.');
    if (['awaiting-approval', 'approved', 'in-review', 'closed'].indexOf(x.status) !== -1) return no('It is ' + x.status + ': reopen it to analyze it again.');
    const parent = b.refine && x.fixId ? x.fixId : '';
    // the page as it looks: its latest screenshot from Application pages, after the issue's own (when there is one)
    let pageShot = [];
    try { pageShot = o.pages && typeof o.pages.shotImages === 'function' ? o.pages.shotImages(x.page, 1).map((im) => ({ name: im.name, mime: im.mime, base64: im.base64 })) : []; } catch (e) { pageShot = []; }
    const own = imagesOf(x);
    const r = await o.fix.analyze({ id: x.page, request: issueText(x) + (pageShot.length ? '\n\n(The last image is the page as it looks now, from Application pages' + (own.length ? '; the others came with the issue' : '') + '.)' : ''),
      kind: x.kind === 'bug' ? 'fix' : x.kind, images: own.concat(pageShot).slice(0, 7), issue: { key: keyOf(x), title: (x.formatted && x.formatted.title) || x.title },
      context: fddContext(x), refine: str(b.refine), parent: parent, by: b.by });
    if (!r.ok) return no(r.error);
    const fx = r.fix;
    x.fixId = fx.id;
    x.verdict = fx.verdict || { code: fx.files.length ? 'fix-here' : '', text: '' };
    if (!x.verdict.code && fx.files.length) x.verdict.code = 'fix-here';
    x.status = x.verdict.code === 'needs-info' || fx.status === 'questions' ? 'needs-info' : (x.verdict.code && x.verdict.code !== 'fix-here' ? 'triaged' : 'analyzed');
    ev(x, b.refine ? 'analyzed again' : 'analyzed', fx.provider || 'AI', (VERDICT_LABEL[x.verdict.code] || 'no verdict') + (fx.files.length ? ' · ' + fx.files.length + ' file(s) to change' : ''));
    await jiraComment(x, 'h4. Build.Rite analysis\n*Verdict:* ' + (VERDICT_LABEL[x.verdict.code] || '—') + '\n' + str(x.verdict.text).split('\n').slice(1).join('\n').trim()
      + (fx.files.length ? '\n*Change proposed:* ' + fx.files.map((f) => '{{' + f + '}}').join(', ') : ''));
    put(x);
    return ok(x);
  }

  // ── approval: in the app (self-approval for now) and an email ──
  function emailHtml(x, fx, code) {
    const f = x.formatted || {};
    const sec = (t) => { const m = new RegExp('##\\s+' + t + '\\s*\\n([\\s\\S]*?)(\\n##\\s|$)', 'i').exec(str(fx.markdown)); return m ? m[1].trim() : ''; };
    const diff = (fx.diff || []).map((d) => '<p style="margin:14px 0 4px;font:600 13px Segoe UI,Arial">' + esc(d.file) + ' <span style="color:#2f7d4f">+' + d.added + '</span> <span style="color:#b3311f">−' + d.removed + '</span></p>'
      + '<pre style="margin:0;padding:8px;background:#f6f8fa;border:1px solid #d4dce4;border-radius:6px;font:12px Consolas,monospace;white-space:pre-wrap">'
      + d.hunks.map((h) => h.rows.map((r) => '<span style="display:block;background:' + (r.t === '+' ? '#e6f6ea' : r.t === '-' ? '#fdecea' : 'transparent') + '">' + esc((r.t === ' ' ? ' ' : r.t) + ' ' + r.s) + '</span>').join('')).join('<hr style="border:0;border-top:1px dashed #ccc">')
      + '</pre>').join('');
    const checks = (fx.checks || []).map((c) => '<li>' + (c.ok ? '✓' : (c.warn ? '⚠' : '✗')) + ' ' + esc(c.name) + '</li>').join('');
    return '<div style="font:14px/1.5 Segoe UI,Arial,sans-serif;color:#16212c;max-width:880px">'
      + '<div style="background:#2c5266;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0"><div style="font-size:12px;opacity:.8">BUILD.RITE · APPROVAL</div><div style="font-size:20px;font-weight:700">' + esc(keyOf(x)) + ' · ' + esc(f.title || x.title) + '</div>'
      + '<div style="font-size:13px;opacity:.85">' + esc(x.label) + ' (' + esc(x.page) + ')</div></div>'
      + '<div style="border:1px solid #d4dce4;border-top:0;padding:14px 18px;border-radius:0 0 8px 8px">'
      + '<p style="margin:0 0 10px;padding:10px 12px;background:#fff4d6;border-radius:6px"><b>To approve:</b> reply with <b>APPROVE</b> on the first line (or <b>REJECT</b> and why), or approve it in Build.Rite → Issues → ' + esc(keyOf(x)) + '. Code: ' + esc(code) + '</p>'
      + (f.summary ? '<p>' + esc(f.summary) + '</p>' : '')
      + '<p><b>Verdict:</b> ' + esc(VERDICT_LABEL[x.verdict && x.verdict.code] || '') + '</p>'
      + (sec('Summary') ? '<p><b>The fix:</b> ' + esc(sec('Summary')) + '</p>' : '')
      + (sec('After the change') ? '<p><b>After the change:</b><br>' + esc(sec('After the change')).replace(/\n/g, '<br>') + '</p>' : '')
      + (sec('Risks') ? '<p><b>Risks:</b> ' + esc(sec('Risks')) + '</p>' : '')
      + '<h3 style="font-size:15px;margin:16px 0 4px">The change</h3>' + diff
      + (checks ? '<h3 style="font-size:15px;margin:16px 0 4px">Checks</h3><ul style="margin:0;padding-left:18px">' + checks + '</ul>' : '')
      + (sec('How to test') ? '<h3 style="font-size:15px;margin:16px 0 4px">How to test</h3><p>' + esc(sec('How to test')).replace(/\n/g, '<br>') + '</p>' : '')
      + '<p style="color:#6b7886;font-size:12px;margin-top:18px">Proposed by ' + esc(fx.provider || 'AI') + ' in Build.Rite for ' + esc(x.by || 'the team') + '. Once approved, the change is applied on its own branch (fix/' + esc(keyOf(x)) + '), tested, and a pull request is made.</p>'
      + '</div></div>';
  }
  async function ask(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    const fx = fixOf(x);
    if (!fx || x.verdict.code !== 'fix-here' || (fx.status !== 'proposed' && fx.status !== 'undone')) return no('Only an analyzed issue with a fix on this page (proposed, checks passing) goes for approval.');
    const code = 'BR-' + crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
    x.approval = { requested: { at: now().toISOString(), by: str(b.by), code: code, fingerprint: fingerprint(fx), email: { wanted: b.email !== false, sent: false, to: '', error: '' } } };
    x.status = 'awaiting-approval';
    if (b.email !== false) {
      const st = o.mail && typeof o.mail.status === 'function' ? (() => { try { return o.mail.status(); } catch (e) { return {}; } })() : {};
      const to = str(b.to).trim() || st.account || '';
      if (!o.mail || !st.signedIn) x.approval.requested.email.error = 'Not signed in to Microsoft 365 (Standup minutes → email settings): no email sent.';
      else if (!to) x.approval.requested.email.error = 'No address to send it to.';
      else {
        const r = await o.mail.sendMail({ to: to, subject: '[Build.Rite] Approve ' + keyOf(x) + ' · ' + x.label + ' (' + code + ')', html: emailHtml(x, fx, code) });
        x.approval.requested.email = { wanted: true, sent: !!(r && r.ok), to: to, error: r && r.ok ? '' : (r && r.error) || 'Not sent.' };
      }
    }
    ev(x, 'sent for approval', b.by, x.approval.requested.email.sent ? 'email to ' + x.approval.requested.email.to + ' (' + code + ')' : 'in the app' + (x.approval.requested.email.error ? ' — ' + x.approval.requested.email.error : ''));
    await jiraComment(x, 'Sent for approval (' + code + ').');
    put(x);
    return ok(x);
  }
  async function approve(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (x.status !== 'awaiting-approval') return no('It is not waiting for approval.');
    const fx = fixOf(x);
    if (!fx || fingerprint(fx) !== x.approval.requested.fingerprint) return no('The change is not the one sent for approval any more: analyze and send it again.');
    x.approval.decision = { approved: true, by: str(b.by), at: now().toISOString(), via: b.via === 'email' ? 'email' : 'app' };
    x.status = 'approved';
    ev(x, 'approved', b.by, 'in ' + (x.approval.decision.via === 'email' ? 'an email reply' : 'Build.Rite'));
    await jiraComment(x, 'Approved by ' + (b.by || 'someone') + ' (' + x.approval.decision.via + ').');
    put(x);
    return ok(x);
  }
  async function reject(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (x.status !== 'awaiting-approval') return no('It is not waiting for approval.');
    x.approval.decision = { approved: false, by: str(b.by), at: now().toISOString(), via: 'app', reason: str(b.reason) };
    x.status = 'rejected';
    ev(x, 'rejected', b.by, str(b.reason));
    await jiraComment(x, 'Rejected by ' + (b.by || 'someone') + (b.reason ? ': ' + b.reason : '.'));
    put(x);
    return ok(x);
  }

  // ── the agent: the approved change on a branch of its own, tested, pushed, a pull request ──
  // its steps, live: { id: { at, steps: { key: { state, detail, at, ms } }, done, ok, error } } (kept 15 minutes after)
  const agentRuns = {};
  function agentView(run, list) {
    const t = Date.now();
    return { ok: true, running: !!run && !run.done, done: !!run && run.done, okRun: !!run && !!run.ok, error: run ? run.error || '' : '', started: run ? new Date(run.at).toISOString() : '',
      seconds: run ? Math.round(((run.done ? run.end : t) - run.at) / 1000) : 0, log: run ? (run.log || []).slice(-300) : [],
      steps: (list || AGENT_STEPS).map((s) => { const x = (run && run.steps[s[0]]) || {}; return { key: s[0], label: s[1], state: x.state || 'pending', detail: x.detail || '', seconds: x.at ? Math.round(((x.end || (x.state === 'running' && !(run && run.done) ? t : x.at)) - x.at) / 1000) : 0 }; }) };
  }
  /** The agent's steps and log: live while it works (and a while after), else the last run kept with the issue. */
  function progress(id, kind) {
    if (kind === 'sandbox') {
      const liveS = sbRuns[str(id)];
      if (liveS) return agentView(liveS, SANDBOX_STEPS);
      const rec = sbGet(id);
      return rec && rec.run ? Object.assign({}, rec.run, { ok: true, running: false, done: true }) : agentView(null, SANDBOX_STEPS);
    }
    const live = agentRuns[str(id)];
    if (live) return agentView(live);
    const x = byId(id);
    return x && x.agentRun ? Object.assign({}, x.agentRun, { ok: true, running: false, done: true }) : agentView(null);
  }
  async function apply(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (x.status !== 'approved') return no('Approve it first.');
    const fx = fixOf(x);
    if (!fx || fingerprint(fx) !== x.approval.requested.fingerprint) return no('The change is not the one approved any more: analyze and send it again.');
    const k = keyOf(x), f = x.formatted || {};
    const message = k + ': ' + (f.title || x.title) + '\n\n' + (f.summary || '') + '\n\nPage: ' + x.label + ' (' + x.page + ')\nApproved by ' + (x.approval.decision.by || 'someone') + ' (' + x.approval.decision.via + ') '
      + x.approval.decision.at + '.\nProposed by ' + (fx.provider || 'AI') + ' in Build.Rite.' + (x.jira && x.jira.url ? '\nJira: ' + x.jira.url : '');
    const prBody = '**' + k + '** · ' + (f.title || x.title) + '\n\n' + (f.summary || '') + '\n\n**Page:** ' + x.label + ' (`' + x.page + '`)\n\n' + str(fx.markdown).slice(0, 2500)
      + '\n\n---\nApproved by ' + (x.approval.decision.by || 'someone') + ' · proposed by ' + (fx.provider || 'AI') + ' in Build.Rite' + (x.jira && x.jira.url ? ' · ' + x.jira.url : '');
    ev(x, 'agent started', b.by, 'branch fix/' + k);
    const run = agentRuns[x.id] = { at: Date.now(), steps: {}, done: false, ok: false, error: '', log: [] };
    const onStep = (s) => {
      run.log.push({ t: Date.now() - run.at, key: s.key, state: s.state, text: s.detail });
      if (run.log.length > 400) run.log.splice(0, run.log.length - 400);
      if (s.key === 'end') { run.done = true; run.end = Date.now(); run.ok = s.state === 'done'; if (!run.ok) run.error = s.detail; return; }
      if (s.state === 'log') return; // a line of its log, not a step's state
      const cur = run.steps[s.key] || {};
      const next = { state: s.state, detail: s.detail, at: cur.at || Date.now(), end: s.state === 'running' ? 0 : Date.now() };
      run.steps[s.key] = next;
    };
    const why = str(b.reason).trim().slice(0, 300);
    if (b.anyway && !why) return no('Say why it may go in with the failing test (it is kept in its history and the pull request).');
    const agreedWhy = keyOf(x) + ': ' + (f.title || x.title) + ' — approved by ' + (x.approval.decision.by || 'someone') + (why ? ' (' + why + ')' : '');
    // tried in its sandbox: committed and pushed from there — but only the change approved
    const sbx = sbHere(x.id);
    if (sbx && sbx.fingerprint !== x.approval.requested.fingerprint) { delete agentRuns[x.id]; return no('The sandbox holds an earlier version of the fix: make it again (Update the sandbox), then apply.', { sandboxOld: true }); }
    const r = await o.fix.applyToBranch({ fix: fx.id, branch: 'fix/' + k, by: b.by, sandbox: sbx || undefined, prBody: prBody + (b.anyway ? '\n\n**Applied with a failing test:** ' + why : '') + (b.allowOld ? '\n\n**Old EquipRite:** this change is agreed (named in tests/old-app-unchanged.test.js).' : ''),
      message: message + (b.anyway ? '\nApplied with a failing test: ' + why : '') + (b.allowOld ? '\nAgreed for Old EquipRite (tests/old-app-unchanged.test.js).' : ''),
      onStep: onStep, anyway: !!b.anyway, anywayWhy: why, allowOld: !!b.allowOld, allowOldWhy: agreedWhy });
    if (!run.done) { run.done = true; run.end = Date.now(); run.ok = !!r.ok; }
    run.error = r.ok ? '' : str(r.error);
    // the run's log and steps kept with the issue (shown after a restart, shared with everyone)
    x.agentRun = Object.assign(agentView(run), { log: run.log.slice(-300) });
    const stale = setTimeout(() => { if (agentRuns[x.id] === run) delete agentRuns[x.id]; }, 15 * 60000);
    if (stale.unref) stale.unref();
    if (!r.ok) {
      x.lastError = r.error;
      x.lastRun = { at: now().toISOString(), broke: !!r.broke, stale: !!r.stale, tests: r.fix && r.fix.tests ? r.fix.tests : null };
      ev(x, r.stale ? 'out of date' : (r.broke ? 'tests broke' : 'agent failed'), 'agent', r.error);
      if (r.stale) x.status = 'analyzed';
      put(x);
      return no(r.error, { issue: view(x) });
    }
    const ba = r.fix.branchApply || {};
    x.branch = { name: ba.branch, base: ba.base, sha: ba.sha, pushed: ba.pushed, pr: ba.pr, pushError: ba.pushError, at: ba.at, fromSandbox: !!sbx };
    if (sbx) sbPut(x.id, Object.assign(sbx, { promoted: { at: now().toISOString(), sha: ba.sha, by: str(b.by) } }));
    x.status = 'in-review';
    x.lastError = '';
    x.lastRun = null;
    if (b.anyway) ev(x, 'applied with a failing test', b.by, why);
    if (b.allowOld) ev(x, 'agreed for Old EquipRite', b.by, 'its files named in tests/old-app-unchanged.test.js, in the same commit');
    ev(x, 'applied on a branch', 'agent', ba.branch + ' · ' + ba.sha + (ba.pushed ? ' · pushed' : ' · not pushed: ' + ba.pushError));
    if (ba.pr) ev(x, 'pull request ready', 'agent', ba.pr.split('?')[0]);
    await jiraComment(x, 'Fixed on branch {{' + ba.branch + '}} (' + ba.sha + ')' + (r.fix.tests && r.fix.tests.ok ? ', tests passing' : '') + '.' + (ba.pr ? '\nPull request: ' + ba.pr.split('?')[0] : ''));
    put(x);
    return ok(x);
  }
  // ── the sandbox: the fix tried first, in a copy of the code on this PC, before anyone approves it ──
  // Kept on this PC only (issue-sandboxes.json beside issues.json: { issueId: sandbox }), never on the data branch: its
  // folder is this PC's. The issue's history says it was made, tested, screenshotted — that is shared.
  const sbFile = file ? path.join(path.dirname(file), 'issue-sandboxes.json') : '';
  let sbMem = {};
  const sbAll = () => { if (!sbFile) return sbMem; try { return JSON.parse(fs.readFileSync(sbFile, 'utf8')) || {}; } catch (e) { return {}; } };
  const sbGet = (id) => sbAll()[str(id)] || null;
  function sbPut(id, rec) {
    const all = sbAll();
    if (rec) all[str(id)] = rec; else delete all[str(id)];
    sbMem = all;
    if (sbFile) { fs.mkdirSync(path.dirname(sbFile), { recursive: true }); fs.writeFileSync(sbFile, JSON.stringify(all, null, 1)); }
  }
  const thisPc = () => require('os').hostname();
  /** The issue's sandbox when it is on this PC and its folder is there. */
  const sbHere = (id) => { const r = sbGet(id); return r && r.dir && (!r.pc || r.pc === thisPc()) && fs.existsSync(r.dir) ? r : null; };
  /** What the screen shows of it (no git: quick); sandbox(id, { act: 'status' }) adds what changed, how far behind, the diff. */
  function sbView(x) {
    const r = sbGet(x.id);
    if (!r) return null;
    const fx = fixOf(x);
    return { branch: r.branch, start: r.start, baseCommit: str(r.baseCommit).slice(0, 7), at: r.at, by: r.by, folder: r.dir, exists: !!sbHere(x.id), built: r.built || null,
      files: Object.keys(r.files || {}), old: !!fx && r.fingerprint !== fingerprint(fx), approvedOld: !!(x.approval && x.approval.requested && r.fingerprint !== x.approval.requested.fingerprint),
      tests: r.tests || null, shots: r.shots ? { at: r.shots.at, before: !!r.shots.before, after: !!r.shots.after, beforeError: r.shots.beforeError || '' } : null, promoted: r.promoted || null };
  }
  const sbRuns = {};
  /**
   * The sandbox's acts: make (the fix written into a copy of the code and built; its steps live in progress(id,
   * 'sandbox')), status ({ diff }), run ({ which: sandbox|current } — opened in a window of the desktop app, else its
   * address), shots (before / after), tests, remove.
   */
  async function sandbox(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (!o.fix || typeof o.fix.makeSandbox !== 'function') return no('Sandboxes are not set up here.');
    const act = str(b.act);
    const k = keyOf(x);
    if (act === 'make') {
      const fx = fixOf(x);
      if (!fx || !(fx.files || []).length) return no('There is no proposed change to try: analyze it first.');
      if (['in-review', 'verified', 'closed'].indexOf(x.status) !== -1) return no('It is ' + (STATUS_LABEL[x.status] || x.status) + ': its change is on ' + ((x.branch && x.branch.name) || 'its branch') + ' already.');
      if (agentRuns[x.id] && !agentRuns[x.id].done) return no('The agent is applying it: wait for it to finish.');
      if (sbRuns[x.id] && !sbRuns[x.id].done) return no('The sandbox is being made already.');
      const was = sbGet(x.id);
      const run = sbRuns[x.id] = { at: Date.now(), steps: {}, done: false, ok: false, error: '', log: [], kind: 'sandbox' };
      const onStep = (s) => {
        run.log.push({ t: Date.now() - run.at, key: s.key, state: s.state, text: s.detail });
        if (run.log.length > 400) run.log.splice(0, run.log.length - 400);
        if (s.key === 'end') { run.done = true; run.end = Date.now(); run.ok = s.state === 'done'; if (!run.ok) run.error = s.detail; return; }
        if (s.state === 'log') return;
        const cur = run.steps[s.key] || {};
        run.steps[s.key] = { state: s.state, detail: s.detail, at: cur.at || Date.now(), end: s.state === 'running' ? 0 : Date.now() };
      };
      const r = await o.fix.makeSandbox({ fix: fx.id, branch: 'fix/' + k, by: b.by, onStep: onStep });
      if (!run.done) { run.done = true; run.end = Date.now(); run.ok = !!r.ok; }
      run.error = r.ok ? '' : str(r.error);
      const runView = Object.assign(agentView(run, SANDBOX_STEPS), { log: run.log.slice(-300) });
      const gone = setTimeout(() => { if (sbRuns[x.id] === run) delete sbRuns[x.id]; }, 15 * 60000);
      if (gone.unref) gone.unref();
      if (!r.ok) {
        sbPut(x.id, was && fs.existsSync(was.dir || '') ? Object.assign(was, { run: runView }) : (r.stale ? null : { run: runView, failed: true, at: now().toISOString(), by: str(b.by) }));
        ev(x, 'sandbox not made', b.by, r.error);
        put(x);
        return no(r.error, { issue: view(x), stale: !!r.stale });
      }
      sbPut(x.id, Object.assign(r.sandbox, { fingerprint: fingerprint(fx), run: runView, shots: null, tests: null }));
      ev(x, was ? 'sandbox made again' : 'sandbox made', b.by, r.sandbox.branch + ' from ' + r.sandbox.start + ' @ ' + str(r.sandbox.baseCommit).slice(0, 7) + (r.sandbox.built.ok ? ', built' : ', not built: ' + str(r.sandbox.built.error).slice(0, 160)));
      put(x);
      return ok(x, { warning: r.warning || '' });
    }
    const rec = sbGet(x.id);
    if (!rec || !rec.dir) return no('There is no sandbox for ' + k + ' yet: make it first.');
    if (act === 'status') {
      const st = await o.fix.sandboxStatus(rec, { diff: !!b.diff });
      return Object.assign({ ok: true, issue: view(x) }, { status: st });
    }
    if (act === 'run') {
      const r = await o.fix.sandboxRun(rec);
      if (!r.ok) return no(r.error);
      const which = b.which === 'current' ? 'current' : 'sandbox';
      const url = which === 'current' ? r.current : r.url;
      if (!url) return no('EquipRite is not running here as it is now, so there is nothing to compare with.');
      let opened = false;
      if (typeof o.openWindow === 'function' && b.open !== false) {
        try { opened = !!(await o.openWindow(url, (which === 'current' ? 'As it is now — ' : 'Sandbox ' + k + ' — ') + x.label)); } catch (e) { opened = false; }
      }
      return Object.assign({ ok: true, issue: view(x) }, { url: url, opened: opened, route: r.route, needs: r.needs, sandboxUrl: r.url, currentUrl: r.current });
    }
    if (act === 'shots') {
      const r = await o.fix.sandboxShots(rec);
      if (!r.ok) return no(r.error);
      const folder = path.join(dir, x.id);
      fs.mkdirSync(folder, { recursive: true });
      const save = (im, name) => { if (!im || !im.base64) return null; const f = name + (im.mime === 'image/png' ? '.png' : '.jpg'); fs.writeFileSync(path.join(folder, f), Buffer.from(im.base64, 'base64')); return { mime: im.mime || 'image/jpeg', file: f }; };
      rec.shots = { at: now().toISOString(), by: str(b.by), after: save(r.after, 'sandbox-after'), before: save(r.before, 'sandbox-before'), beforeError: r.beforeError || '' };
      sbPut(x.id, rec);
      ev(x, 'sandbox screenshots', b.by, 'before (the app as it is now)' + (rec.shots.before ? '' : ' — not taken: ' + rec.shots.beforeError) + ' and after (the sandbox)');
      put(x);
      return ok(x);
    }
    if (act === 'tests') {
      const r = await o.fix.sandboxTests(rec);
      if (!r.ok) return no(r.error);
      rec.tests = r.tests;
      sbPut(x.id, rec);
      ev(x, 'sandbox tested', b.by, r.tests.ok ? 'nothing broke' + (r.tests.unit.length ? ' (' + r.tests.unit.length + ' test file(s), the page checks)' : ' (the page checks)') : r.tests.bad + ' new failure(s)');
      put(x);
      return ok(x);
    }
    if (act === 'remove') {
      if (agentRuns[x.id] && !agentRuns[x.id].done) return no('The agent is applying it from the sandbox: wait for it to finish.');
      const r = await o.fix.removeSandbox(rec, { by: b.by, keepBranch: !!(x.branch && x.branch.pushed) });
      if (!r.ok) return no(r.error);
      sbPut(x.id, null);
      ['sandbox-after', 'sandbox-before'].forEach((n) => ['.jpg', '.png'].forEach((e) => { try { fs.unlinkSync(path.join(dir, x.id, n + e)); } catch (er) { /* none */ } }));
      ev(x, 'sandbox thrown away', b.by, rec.branch + ': its folder deleted' + (x.branch && x.branch.pushed ? ' (the branch kept for its pull request)' : ''));
      put(x);
      return ok(x);
    }
    return no('Not a sandbox act: ' + act);
  }

  /** QA: the fix tried in an environment (SIT, UAT…) on a build. Passed: verified, ready to close. Failed: back to be fixed. */
  async function verify(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (x.status !== 'in-review') return no('Verify a fix once it is applied and its pull request made.');
    const passed = b.passed !== false && b.passed !== 'false';
    const env = ENVS.indexOf(str(b.env)) !== -1 ? str(b.env) : '';
    x.verification = { passed, by: str(b.by), at: now().toISOString(), env, build: str(b.build).trim().slice(0, 60), notes: str(b.notes).trim().slice(0, 2000) };
    if (passed) {
      x.status = 'verified';
      ev(x, 'verified', b.by, [env, x.verification.build, x.verification.notes].filter(Boolean).join(' · '));
    } else {
      if (!x.verification.notes) return no('Say what still goes wrong, so it can be fixed again.');
      x.status = 'written';
      x.approval = null;
      ev(x, 'verification failed', b.by, [env, x.verification.build, x.verification.notes].filter(Boolean).join(' · '));
    }
    await jiraComment(x, (passed ? 'Verified' : 'Verification failed') + (env ? ' in ' + env : '') + (x.verification.build ? ' on ' + x.verification.build : '') + ' by ' + (b.by || 'someone') + (x.verification.notes ? ':\n' + x.verification.notes : '.'));
    put(x);
    return ok(x);
  }
  /** What a closed issue says by default: Fixed once applied; for a verdict, its own (works as designed, out of scope…). */
  function defaultResolution(x) {
    if (['in-review', 'verified'].indexOf(x.status) !== -1) return x.kind === 'bug' ? 'fixed' : 'done';
    const v = x.verdict && x.verdict.code;
    return v === 'as-designed' ? 'as-designed' : v === 'out-of-scope' ? 'out-of-scope' : v === 'fix-elsewhere' ? 'moved' : v === 'needs-info' ? 'cannot-reproduce' : 'wont-fix';
  }
  async function close(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (x.status === 'closed') return no('It is closed already.');
    const code = RESOLUTION[str(b.resolution)] ? str(b.resolution) : defaultResolution(x);
    const cause = ROOT_CAUSE[str(b.rootCause)] ? str(b.rootCause) : '';
    x.resolution = { code, rootCause: cause, rootNotes: str(b.rootNotes).trim().slice(0, 2000), fixedIn: str(b.fixedIn).trim().slice(0, 60) || (code === 'fixed' || code === 'done' ? str((x.details || {}).fixVersion || (x.verification || {}).build) : ''),
      note: str(b.note).trim().slice(0, 2000), by: str(b.by), at: now().toISOString() };
    x.status = 'closed';
    x.closed = { at: x.resolution.at, by: str(b.by), note: x.resolution.note };
    const sbc = sbHere(x.id);
    if (sbc) {
      const gone = await o.fix.removeSandbox(sbc, { by: b.by, keepBranch: !!(x.branch && x.branch.pushed) });
      if (gone.ok) { sbPut(x.id, null); ev(x, 'sandbox removed', b.by, 'closed: its folder deleted' + (x.branch && x.branch.pushed ? ' (the branch kept for its pull request)' : '')); }
    }
    ev(x, 'closed', b.by, RESOLUTION[code] + (x.resolution.fixedIn ? ' · fixed in ' + x.resolution.fixedIn : '') + (cause ? ' · root cause: ' + ROOT_CAUSE[cause] : '') + (x.resolution.note ? ' · ' + x.resolution.note : ''));
    await jiraComment(x, 'Closed in Build.Rite as *' + RESOLUTION[code] + '*' + (x.resolution.fixedIn ? ' (fixed in ' + x.resolution.fixedIn + ')' : '') + '.'
      + (cause ? '\n*Root cause:* ' + ROOT_CAUSE[cause] + (x.resolution.rootNotes ? ' — ' + x.resolution.rootNotes : '') : '') + (x.resolution.note ? '\n' + x.resolution.note : ''));
    put(x);
    return ok(x);
  }
  function reopen(id, b) {
    const x = byId(id);
    if (!x) return no('No such issue.');
    x.status = x.formatted ? 'written' : 'new';
    x.approval = null;
    x.resolution = null;
    x.verification = null;
    ev(x, 'reopened', (b && b.by) || '', '');
    put(x);
    return ok(x);
  }

  /** Its details (severity, priority, environment, releases, customer, who and when, assignee, due date): at any stage. */
  function details(id, f, b) {
    const x = byId(id);
    if (!x) return no('No such issue.');
    const c = cleanDetails(f || {}, x.details || {});
    const warning = c.bad.length ? 'Not an email address, left out: ' + c.bad.join(', ') + '.' : '';
    if (f && f.kind && ['bug', 'enhancement', 'change'].indexOf(f.kind) !== -1 && f.kind !== x.kind) { c.changed.unshift('Type: ' + x.kind + ' → ' + f.kind); x.kind = f.kind; }
    if (!c.changed.length) return ok(x, { unchanged: true, warning });
    x.details = c.details;
    ev(x, 'details changed', (b && b.by) || '', c.changed.join('; '));
    put(x);
    return ok(x, warning ? { warning } : {});
  }
  /** A word in its discussion — a comment, a response to the customer (emailed to them when asked), an internal note — by
   *  anyone, at any stage. In Jira too (not an internal note). */
  async function comment(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    const text = str(b.text).trim();
    if (!text) return no('Write something first.');
    const kind = COMMENT_KIND[b.kind] ? b.kind : 'comment';
    const c = { id: 'c' + now().getTime().toString(36) + crypto.randomBytes(2).toString('hex'), at: now().toISOString(), by: str(b.by), kind, text: text.slice(0, 8000), stage: STEPS[STAGE[x.status] || 0] };
    if (b.email) {
      const to = str(b.to).trim() || str((x.details || {}).reporterEmail);
      const st = o.mail && typeof o.mail.status === 'function' ? (() => { try { return o.mail.status(); } catch (e) { return {}; } })() : {};
      if (!isEmail(to)) c.email = { sent: false, to, error: 'No email address to send it to (the reporter\'s email, in its details).' };
      else if (!o.mail || !st.signedIn) c.email = { sent: false, to, error: 'Not signed in to Microsoft 365 (Standup minutes → email settings): not emailed.' };
      else {
        const f = x.formatted || {};
        const html = '<div style="font:14px/1.5 Segoe UI,Arial,sans-serif;color:#16212c;max-width:760px"><div style="background:#2c5266;color:#fff;padding:12px 16px;border-radius:8px 8px 0 0">'
          + '<div style="font-size:12px;opacity:.8">' + esc(keyOf(x)) + ' · ' + esc(x.label) + '</div><div style="font-size:18px;font-weight:700">' + esc(f.title || x.title) + '</div></div>'
          + '<div style="border:1px solid #d4dce4;border-top:0;padding:14px 16px;border-radius:0 0 8px 8px">' + esc(text).replace(/\n/g, '<br>')
          + '<p style="color:#6b7886;font-size:12px;margin-top:16px">' + esc(b.by || 'The EquipRite team') + ' · reply to this email to answer.</p></div></div>';
        const r = await o.mail.sendMail({ to, subject: '[' + keyOf(x) + '] ' + (f.title || x.title), html });
        c.email = { sent: !!(r && r.ok), to, error: r && r.ok ? '' : (r && r.error) || 'Not sent.' };
      }
    }
    x.comments = (x.comments || []).concat([c]);
    ev(x, kind === 'response' ? 'responded to the customer' : kind === 'internal' ? 'internal note' : 'commented', b.by, text.slice(0, 160) + (c.email ? (c.email.sent ? ' · emailed to ' + c.email.to : ' · not emailed: ' + c.email.error) : ''));
    if (kind !== 'internal') await jiraComment(x, (kind === 'response' ? '*Response to the customer* by ' : '*Comment* by ') + (b.by || 'someone') + ':\n' + text);
    put(x);
    return ok(x, c.email && !c.email.sent ? { warning: c.email.error } : {});
  }
  /** A follow-up email about the issue (more information, a status update, anything): to its Notify list and the reporter
   *  unless told otherwise; kept in its discussion (and in Jira). */
  async function email(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    const d = x.details || {};
    const given = str(b.to).trim();
    const to = emailsOf(given || (d.notify || []).concat(d.reporterEmail ? [d.reporterEmail] : []));
    const cc = emailsOf(b.cc || '');
    if (to.bad.length || cc.bad.length) return no('Not an email address: ' + to.bad.concat(cc.bad).join(', ') + '.');
    if (!to.ok.length) return no('Who to? Add their emails (or fill its Notify list).');
    const body = str(b.body).trim();
    if (!body) return no('Write the email first (or let the AI draft it).');
    if (!mailReady()) return no('Not signed in to Microsoft 365 (Standup minutes → email settings): nothing was sent.');
    const f = x.formatted || {};
    const subject = str(b.subject).trim() || '[' + keyOf(x) + '] ' + (f.title || x.title);
    const html = '<div style="font:14px/1.55 Segoe UI,Arial,sans-serif;color:#16212c;max-width:760px">' + esc(body).replace(/\n/g, '<br>')
      + '<hr style="border:0;border-top:1px solid #d4dce4;margin:16px 0 8px"><div style="font-size:12px;color:#6b7886">' + esc(keyOf(x)) + ' · ' + esc(f.title || x.title) + ' · ' + esc(x.label)
      + (STATUS_LABEL[x.status] ? ' · ' + esc(STATUS_LABEL[x.status]) : '') + '</div></div>';
    const r = await o.mail.sendMail({ to: to.ok.join(';'), cc: cc.ok.join(';'), subject, html });
    if (!r || !r.ok) return no('Not sent: ' + ((r && r.error) || 'Microsoft 365 did not take it.'));
    const c = { id: 'c' + now().getTime().toString(36) + crypto.randomBytes(2).toString('hex'), at: now().toISOString(), by: str(b.by), kind: 'email', text: body.slice(0, 8000),
      subject: subject.slice(0, 200), stage: STEPS[STAGE[x.status] || 0], email: { sent: true, to: to.ok.join(', '), cc: cc.ok.join(', '), error: '' } };
    x.comments = (x.comments || []).concat([c]);
    ev(x, 'emailed', b.by, subject + ' · to ' + to.ok.join(', ') + (cc.ok.length ? ' · cc ' + cc.ok.join(', ') : ''));
    await jiraComment(x, '*Email* by ' + (b.by || 'someone') + ' to ' + to.ok.join(', ') + ' — ' + subject + ':\n' + body);
    put(x);
    return ok(x);
  }

  const DRAFT_SYSTEM = [
    'You write short, clear, polite emails about a software issue for the team building EquipRite (an Oracle Visual Builder app on Oracle Fusion).',
    'Write as the person sending it, to the people who raised or follow the issue. Plain English, no jargon they would not know, no promises of dates.',
    'Use only the facts given. When asking for information, ask exactly what is missing, as a short numbered list.',
    'Answer ONLY with JSON: {"subject": "a short subject (no issue key: it is added)", "body": "the email text, with a greeting and a sign-off line"}',
  ].join('\n');
  /** The AI drafts a follow-up email (asking for more information — its questions, what is unclear — or a status update);
   *  nothing is sent: it is put in the email box to change and send. */
  async function draft(id, b) {
    b = b || {};
    const x = byId(id);
    if (!x) return no('No such issue.');
    if (!o.ai || typeof o.ai.chat !== 'function') return no('No AI is set up: choose one in AI settings.');
    const purpose = { info: 'Ask for the information that is missing or unclear, so the issue can be analyzed and fixed.', status: 'Tell them where the issue is now and what happens next.' }[b.purpose] || str(b.purpose) || 'Ask for the information that is missing or unclear.';
    const d = x.details || {};
    const qs = ((x.formatted && x.formatted.questions) || []).concat(x.verdict && x.verdict.code === 'needs-info' ? [str(x.verdict.text)] : []);
    const talk = (x.comments || []).filter((c) => c.kind !== 'internal').slice(-6).map((c) => '- ' + (c.by || 'someone') + ' (' + (COMMENT_KIND[c.kind] || 'Comment') + '): ' + str(c.text).slice(0, 500)).join('\n');
    const user = ['PURPOSE: ' + purpose, 'SENDER: ' + (str(b.by) || 'the EquipRite team'), 'STATUS: ' + (STATUS_LABEL[x.status] || x.status) + (x.verdict ? ' · verdict: ' + (VERDICT_LABEL[x.verdict.code] || '') : ''),
      'DETAILS: ' + [d.customer ? 'customer ' + d.customer : '', d.customerRef ? 'ticket ' + d.customerRef : '', d.foundIn ? 'found in ' + d.foundIn : '', d.environment ? 'on ' + d.environment : '', d.reportedBy ? 'raised by ' + d.reportedBy : ''].filter(Boolean).join(', '),
      '', 'THE ISSUE:', issueText(x), qs.length ? '\nWHAT IS MISSING OR UNCLEAR (the AI\'s questions):\n' + qs.map((q) => '- ' + q).join('\n') : '', talk ? '\nTHE DISCUSSION SO FAR:\n' + talk : ''].join('\n');
    const r = await o.ai.chat({ system: DRAFT_SYSTEM, user, maxTokens: 1200 });
    if (!r || !r.ok) return no((r && r.error) || 'The AI did not answer.');
    const j = jsonOf(r.text);
    if (!j || !j.body) return no('The AI did not answer in the expected form: try again.');
    const k = keyOf(x);
    const subj = str(j.subject).replace(/^\s*\[[A-Z][A-Z0-9]*-[A-Z0-9]+\]\s*/, '').trim(); // a key it put in (any): the issue's own is added
    return { ok: true, subject: '[' + k + '] ' + (subj || ((x.formatted && x.formatted.title) || x.title)), body: str(j.body).trim(), provider: r.provider || 'AI',
      to: (d.notify || []).concat(d.reporterEmail && (d.notify || []).indexOf(d.reporterEmail) === -1 ? [d.reporterEmail] : []).join(', ') };
  }

  function settings() { return { ok: true, project: project() }; }
  function setSettings(b) {
    const k = str(b && b.project).trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(k)) return no('A Jira project key is letters and digits, like EQP.');
    const d = load();
    d.settings = Object.assign({}, d.settings, { project: k });
    save(d);
    return { ok: true, project: k };
  }

  return {
    info: info, list: list, get: (id) => { const x = byId(id); return x ? ok(x) : no('No such issue.'); },
    create: create, format: format, update: update, toJira: toJira, analyze: analyze, ask: ask, approve: approve, reject: reject, apply: apply, verify: verify, close: close, reopen: reopen,
    details: details, comment: comment, email: email, draft: draft, settings: settings, setSettings: setSettings, progress: progress, img: img, sandbox: sandbox, flush: () => Promise.all([pub, notes]).then(() => Promise.all([pub, notes])),
  };
}

/** The FDD sections that match an issue: resources/js/fddIndex.js pick() on the library's latest FDD (lib/fdd.js store). */
function fddPicker(fddStore, root) {
  let FI = null;
  const load = () => {
    if (FI) return FI;
    const vm = require('vm');
    const sb = { console: console, define: (deps, f) => { FI = f(); } };
    vm.createContext(sb);
    vm.runInContext(fs.readFileSync(path.join(root, 'webApps', 'equiprite-next', 'resources', 'js', 'fddIndex.js'), 'utf8'), sb, { filename: 'fddIndex.js' });
    return FI;
  };
  return {
    pick(story) {
      const st = typeof fddStore === 'function' ? fddStore() : fddStore;
      if (!st || typeof st.info !== 'function') return '';
      const info = st.info();
      if (!info.latest) return '';
      const doc = JSON.parse(fs.readFileSync(path.join(st.root, 'webApps', 'equiprite-next', 'resources', 'fdd', info.latest + '.json'), 'utf8'));
      const r = load().pick(doc, story, { budget: 12000 });
      return r && r.text ? r.text : '';
    },
  };
}

module.exports = { open, issueText, jiraWiki, jsonOf, fddPicker, mergeIssue, cleanDetails, emailsOf, AGENT_STEPS, SANDBOX_STEPS, STEPS, VERDICT_LABEL, SEVERITY, PRIORITY, ENVS, RESOLUTION, ROOT_CAUSE, COMMENT_KIND };
