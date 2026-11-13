#!/usr/bin/env node
'use strict';
/**
 * Issues (desktop/lib/issues.js) end to end, with real git (a project whose origin is a bare repository; its fetch
 * address GitHub's, so the pull request's address is made), a real page copied in, and stand-ins for the AI, Microsoft
 * 365 (the approval email), Jira (create, read, comments) and the FDD:
 *   log → write-up (the AI) → in Jira → analysis in issue mode (the verdict, the FDD, the issue's number asked for in the
 *   code's comments) → approval (an email with the change; approved in the app) → the agent: a branch of its own
 *   (fix/<KEY>), the commit with the key, pushed, a pull request's address; the checkout untouched → closed.
 *   Out of scope: triaged, nothing to approve. Rejected. A changed proposal cannot be approved.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const CF = require('../desktop/lib/codeFix');
const IS = require('../desktop/lib/issues');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const PAGE = 'webApps/vbredwoodapp/flows/customer-portal/pages/customer-my-billing-page';
const ID = 'vbredwoodapp/customer-portal/customer-my-billing';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const copyDir = (from, to) => { fs.mkdirSync(to, { recursive: true }); fs.readdirSync(from).forEach((f) => { const a = path.join(from, f), b = path.join(to, f); if (fs.statSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b); }); };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

(async () => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (e) { T.check('git is installed (skipping)', true); T.report(); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-issues-'));
  const remote = path.join(tmp, 'origin.git'), A = path.join(tmp, 'project');
  try {
    git(tmp, 'init', '-q', '--bare', '-b', 'main', remote);
    fs.mkdirSync(A); git(A, 'init', '-q', '-b', 'main'); git(A, 'config', 'user.name', 'Tester'); git(A, 'config', 'user.email', 't@example.com');
    ['.json', '.js', '.html'].forEach((x) => { fs.mkdirSync(path.dirname(path.join(A, PAGE)), { recursive: true }); fs.copyFileSync(path.join(ROOT, PAGE + x), path.join(A, PAGE + x)); });
    copyDir(path.join(ROOT, PAGE + '-chains'), path.join(A, PAGE + '-chains'));
    fs.copyFileSync(path.join(ROOT, 'webApps/vbredwoodapp/app-flow.json'), path.join(A, 'webApps/vbredwoodapp/app-flow.json'));
    fs.copyFileSync(path.join(ROOT, 'webApps/vbredwoodapp/flows/customer-portal/customer-portal-flow.json'), path.join(A, 'webApps/vbredwoodapp/flows/customer-portal/customer-portal-flow.json'));
    git(A, 'add', '-A'); git(A, 'commit', '-q', '-m', 'project'); git(A, 'remote', 'add', 'origin', remote); git(A, 'push', '-q', '-u', 'origin', 'main');
    // pushes go to the bare repository; its address as GitHub's (so the pull request's address can be made)
    git(A, 'remote', 'set-url', 'origin', 'https://github.com/acme/equiprite.git'); git(A, 'remote', 'set-url', '--push', 'origin', remote);
    const head0 = git(A, 'rev-parse', 'HEAD');
    const html0 = fs.readFileSync(path.join(A, PAGE + '.html'), 'utf8');
    const anchor = html0.replace(/\r\n/g, '\n').split('\n').slice(1, 3).join('\n');

    const asked = [];
    const answers = [];
    const ai = {
      settings: () => ({ active: 'x', catalog: [{ id: 'x', label: 'Stand-in AI' }] }),
      chat: async (req) => {
        asked.push(req);
        if (/^You write up software issues/.test(req.system)) {
          return { ok: true, provider: 'Stand-in AI', text: 'Here: {"title": "Overdue invoices are not shown first on My Billing", "summary": "On My Billing the overdue invoices are mixed with the others.", "steps": ["Open My Billing", "Look at the list"], "expected": "Overdue first", "actual": "Mixed", "impact": "Customers miss overdue invoices", "kind": "bug", "questions": []}' };
        }
        return { ok: true, provider: 'Stand-in AI', text: answers.shift() };
      },
    };
    const mails = [];
    const mail = { status: () => ({ signedIn: true, account: 'me@example.com' }), sendMail: async (m) => { mails.push(m); return { ok: true }; } };
    const jiraCalls = [];
    let nextKey = 901;
    const jira = {
      auth: () => ({ site: 'https://example.atlassian.net', header: 'Basic abc' }),
      fetch: async (url, init) => {
        jiraCalls.push({ url: url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
        if (/\/rest\/api\/2\/issue$/.test(url)) return { ok: true, status: 201, text: async () => JSON.stringify({ key: 'EQP-' + (nextKey++) }) };
        if (/\/comment$/.test(url)) return { ok: true, status: 201, text: async () => '{}' };
        if (/\/rest\/api\/2\/issue\/EQP-50/.test(url)) return { ok: true, status: 200, text: async () => JSON.stringify({ fields: { summary: 'Totals wrong on My Billing', description: 'The total ignores credit notes.' } }) };
        return { ok: false, status: 404, text: async () => JSON.stringify({ errorMessages: ['Issue does not exist'] }) };
      },
    };
    let clock = Date.parse('2026-11-13T09:00:00Z');
    const now = () => new Date(clock += 1000);
    const fix = CF.open({ root: A, file: path.join(tmp, 'data', 'code-fixes.json'), ai: ai, now: now });
    const store = IS.open({ file: path.join(tmp, 'data', 'issues.json'), ai: ai, fix: fix, mail: mail, jira: jira, now: now,
      fdd: { pick: (story) => 'FDD 7.4 Billing — overdue invoices are listed first (' + story.summary + ')' } });

    const c3dummy = () => 'nope';
    T.section('log, the AI writes it up, into Jira');
    const c1 = await store.create({ page: ID, text: 'overdue invoices are all mixed up on my billing, please fix', kind: 'bug', images: [{ name: 'Pasted image 1', mime: 'image/png', base64: PNG }], by: 'Asha' });
    const is1 = c1.issue;
    T.check('logged against the page, a key of its own, its screenshot kept', c1.ok && /^BR-[A-Z0-9]{5}$/.test(is1.key) && is1.label === 'My Billing' && is1.status === 'new' && is1.images.length === 1 && store.img(is1.id, 1).ok
      && is1.steps.length === 8 && is1.steps[0].state === 'now', JSON.stringify([c1.error, is1 && is1.key]));
    const f1 = await store.format(is1.id, { by: 'Asha' });
    T.check('written up by the AI (title, steps, expected, actual), with the screenshot', f1.ok && f1.issue.status === 'written' && /Overdue invoices/.test(f1.issue.formatted.title) && f1.issue.formatted.steps.length === 2
      && (asked[0].images || []).length === 1, JSON.stringify(f1.error));
    const j1 = await store.toJira(is1.id, { by: 'Asha' });
    const created = jiraCalls.filter((c) => /\/issue$/.test(c.url))[0];
    T.check('created in Jira: a Bug in EQP, its write-up; the key is now Jira\'s', j1.ok && j1.issue.key === 'EQP-901' && j1.issue.jira.url === 'https://example.atlassian.net/browse/EQP-901'
      && created.body.fields.project.key === 'EQP' && created.body.fields.issuetype.name === 'Bug' && /Steps to reproduce/.test(created.body.fields.description), JSON.stringify(j1.error));

    T.section('analysis: the verdict, the FDD, the issue\'s number in the code');
    answers.push(['## Verdict', 'Fix on this page — the list is not sorted by due date.', '## Summary', 'Sort overdue first.', '## How it works today', 'BilledRequestInitChain loads them.', '## What is wrong', 'No sort.',
      '## The change', '- the page', '## After the change', 'Overdue first.', '## Risks', 'None known', '## How to test', '1. Open My Billing.', '## Questions', 'None', '',
      'FILE: ' + PAGE + '.html', '<<<<<<< SEARCH', anchor, '=======', anchor + '\n  <!-- EQP-901: overdue invoices first -->', '>>>>>>> REPLACE'].join('\n'));
    const a1 = await store.analyze(is1.id, { by: 'Asha' });
    const sys = asked[asked.length - 1];
    T.check('analyzed in issue mode: the rules ask for the verdict and the issue\'s number in comments; the FDD sections go with it', a1.ok && /THIS IS ISSUE EQP-901/.test(sys.system) && /<!-- EQP-901: why -->/.test(sys.system)
      && /FDD 7\.4 Billing/.test(sys.user) && /Steps to reproduce/.test(sys.user), JSON.stringify(a1.error));
    T.check('the verdict: Fix on this page; the change (with its comment) proposed; analyzed', a1.ok && a1.issue.verdict.code === 'fix-here' && a1.issue.verdictLabel === 'Fix on this page' && a1.issue.status === 'analyzed'
      && a1.issue.fix && a1.issue.fix.status === 'proposed' && a1.issue.fix.diff[0].hunks[0].rows.some((r) => r.t === '+' && /EQP-901/.test(r.s)) && a1.issue.stage === 2);
    T.check('…and a comment in Jira with the verdict', jiraCalls.some((c) => /EQP-901\/comment$/.test(c.url) && /Verdict:\* Fix on this page/.test(c.body.body)));

    T.section('approval: the email with the change; approved in the app');
    const s1 = await store.ask(is1.id, { by: 'Asha' });
    const m = mails[0] || {};
    T.check('sent for approval: an email to me, its subject with the key and a code, the change and how to approve in it', s1.ok && s1.issue.status === 'awaiting-approval' && m.to === 'me@example.com'
      && /^\[Build\.Rite\] Approve EQP-901 · My Billing \(BR-[0-9A-F]{5}\)$/.test(m.subject) && /reply with <b>APPROVE<\/b>/.test(m.html) && /EQP-901: overdue invoices first/.test(m.html) && s1.issue.approval.requested.email.sent, JSON.stringify([s1.error, m.subject]));
    T.check('apply is refused before the approval', !(await store.apply(is1.id, { by: 'Asha' })).ok);
    const p1 = await store.approve(is1.id, { by: 'Asha', via: 'app' });
    T.check('approved (self-approval, in the app), in Jira too', p1.ok && p1.issue.status === 'approved' && p1.issue.approval.decision.by === 'Asha' && jiraCalls.some((c) => /Approved by Asha/.test((c.body || {}).body || '')));

    T.section('the agent: a branch of its own, tested, the commit with the key, pushed, the pull request');
    const ap = await store.apply(is1.id, { by: 'Asha' });
    const onBranch = (() => { try { return git(remote, 'show', 'fix/EQP-901:' + PAGE + '.html'); } catch (e) { return ''; } })();
    T.check('pushed on fix/EQP-901: the change with its EQP-901 comment', ap.ok && ap.issue.status === 'in-review' && ap.issue.branch.name === 'fix/EQP-901' && ap.issue.branch.pushed && /<!-- EQP-901: overdue invoices first -->/.test(onBranch), JSON.stringify(ap.error || (ap.issue && ap.issue.branch)));
    T.check('the commit names the issue, the approval and the page', /^EQP-901: Overdue invoices are not shown first on My Billing/.test(git(remote, 'log', '-1', '--format=%s', 'fix/EQP-901'))
      && /Approved by Asha \(app\)/.test(git(remote, 'log', '-1', '--format=%b', 'fix/EQP-901')) && git(remote, 'rev-parse', 'fix/EQP-901^') === head0);
    T.check('the pull request\'s address: GitHub compare main…fix/EQP-901, titled with the key', /^https:\/\/github\.com\/acme\/equiprite\/compare\/main\.\.\.fix%2FEQP-901\?expand=1&title=EQP-901/.test(ap.issue.branch.pr || ''), ap.issue.branch.pr);
    T.check('the person\'s checkout untouched: same commit, same file, nothing changed; no folder left behind', git(A, 'rev-parse', 'HEAD') === head0 && fs.readFileSync(path.join(A, PAGE + '.html'), 'utf8') === html0
      && git(A, 'status', '--porcelain') === '' && git(A, 'worktree', 'list').split('\n').length === 1);
    T.check('the change history: applied on its branch, tested, committed, pushed (by whom)', ['approved and applied', 'tested', 'committed', 'pushed'].every((w) => ap.issue.fix.events.some((e) => e.what === w && (w === 'tested' || e.by === 'Asha'))));
    T.check('…and Jira told: the branch and the pull request', jiraCalls.some((c) => /fix\/EQP-901/.test((c.body || {}).body || '') && /Pull request: https:\/\/github\.com\/acme/.test(c.body.body)));
    T.check('verifying: refused before it is applied elsewhere; a failed one must say what still goes wrong', !(await store.verify(c3dummy(), {})).ok && !(await store.verify(is1.id, { by: 'Ben', passed: false })).ok);
    const vf = await store.verify(is1.id, { by: 'Ben', passed: true, env: 'UAT', build: '26C.2', notes: 'Overdue invoices first now.' });
    T.check('verified in UAT on build 26C.2 (QA): the Verified step reached, Jira told', vf.ok && vf.issue.status === 'verified' && vf.issue.steps[6].state === 'now' && vf.issue.verification.env === 'UAT'
      && jiraCalls.some((c) => /Verified in UAT on 26C\.2 by Ben/.test((c.body || {}).body || '')));
    const cl = await store.close(is1.id, { by: 'Asha', note: 'merged', rootCause: 'code', rootNotes: 'the sort ignored the due date' });
    T.check('closed: the last step done, its timeline from logged to closed', cl.ok && cl.issue.status === 'closed' && cl.issue.steps.every((x) => x.state === 'done')
      && ['logged', 'written up', 'created in Jira', 'analyzed', 'sent for approval', 'approved', 'agent started', 'applied on a branch', 'pull request ready', 'verified', 'closed'].every((w) => cl.issue.events.some((e) => e.what === w)), JSON.stringify(cl.issue.events.map((e) => e.what)));
    T.check('…with its resolution: Fixed (a verified bug), fixed in the build it was verified on, its root cause; in Jira', cl.issue.resolution.code === 'fixed' && cl.issue.resolutionLabel === 'Fixed' && cl.issue.resolution.fixedIn === '26C.2'
      && cl.issue.resolution.rootCause === 'code' && jiraCalls.some((c) => /Closed in Build\.Rite as \*Fixed\* \(fixed in 26C\.2\)[\s\S]*Root cause:\* Code defect — the sort ignored the due date/.test((c.body || {}).body || '')));

    T.section('not a fix on this page: triaged, with what to do; from Jira; rejected');
    const c2 = (await store.create({ page: ID, jiraKey: 'eqp-50', kind: 'change', by: 'Ben' })).issue;
    T.check('brought from Jira: its key and text read from there', c2 && c2.key === 'EQP-50' && /Totals wrong on My Billing/.test(c2.text) && /The total ignores credit notes/.test(c2.text));
    const before = asked.length;
    answers.push('## Verdict\nOut of scope — credit notes on the total is a new requirement (FDD 7.4 lists invoices only).\n## Summary\nA new story.\n## Questions\nNone');
    const a2 = await store.analyze(c2.id, { by: 'Ben' });
    T.check('out of scope: triaged, no change, the AI asked once (nothing to ask again), and nothing to approve', a2.ok && a2.issue.status === 'triaged' && a2.issue.verdict.code === 'out-of-scope' && a2.issue.fix.status === 'triaged'
      && a2.issue.fix.files.length === 0 && asked.length === before + 1 && !(await store.ask(c2.id, { by: 'Ben' })).ok, JSON.stringify([a2.error, a2.issue && a2.issue.status]));
    const c3 = (await store.create({ page: ID, text: 'a label', by: 'Ben' })).issue;
    answers.push(['## Verdict', 'Fix on this page — a label.', '## Summary', 'x', '## Questions', 'None', '', 'FILE: ' + PAGE + '.html', '<<<<<<< SEARCH', anchor, '=======', anchor + '\n  <!-- ' + c3.key + ': label -->', '>>>>>>> REPLACE'].join('\n'));
    await store.analyze(c3.id, { by: 'Ben' });
    await store.ask(c3.id, { by: 'Ben', email: false });
    const rj = await store.reject(c3.id, { by: 'Asha', reason: 'not now' });
    T.check('rejected, with the reason; reopened (never written up: back to logged), it can be analyzed again', rj.ok && rj.issue.status === 'rejected' && rj.issue.approval.decision.reason === 'not now' && store.reopen(c3.id, { by: 'Ben' }).issue.status === 'new');
    const L = store.list({ status: 'all' });
    T.check('the list: newest first, counted by state; found by a word', L.issues.length === 3 && L.counts.closed === 1 && L.counts.open === 2 && store.list({ q: 'credit' }).issues.length === 0 && store.list({ q: 'EQP-50' }).issues[0].key === 'EQP-50');
    T.check('the write-up\'s text for the analysis, and the Jira description', /Steps to reproduce:\n1\. Open My Billing/.test(IS.issueText(cl.issue)) && /\*Page:\* My Billing/.test(IS.jiraWiki(cl.issue)));
    // ── the defect record: details, the AI's severity, the discussion, Jira refusing, the project key, two PCs merged ──
    T.section('details, discussion, resolution');
    const sent = [];
    const jira403 = { auth: () => ({ site: 'https://example.atlassian.net', header: 'Basic abc', email: 'javeed@example.com' }),
      fetch: async (url, init) => { sent.push({ url, body: init.body ? JSON.parse(init.body) : null }); return /\/comment$/.test(url) ? { ok: true, status: 201, text: async () => '{}' } : { ok: false, status: 403, text: async () => '' }; } };
    const ai2 = { chat: async () => ({ ok: true, provider: 'Stand-in AI', text: '{"title": "Totals wrong", "summary": "x", "steps": [], "kind": "bug", "severity": "critical", "priority": "p1", "why": "Billing is wrong for every customer."}' }) };
    const st2 = IS.open({ file: path.join(tmp, 'data2', 'issues.json'), ai: ai2, mail: { status: () => ({ signedIn: true, account: 'me@example.com' }), sendMail: async (m) => { sent.push(m); return { ok: true }; } }, jira: jira403, now: now });
    const d1 = await st2.create({ page: ID, text: 'totals wrong', kind: 'bug', by: 'Asha',
      details: { severity: 'major', environment: 'UAT', foundIn: '26C', customer: 'Acme Rentals', customerRef: 'INC-1042', reporterEmail: 'not an email', raisedOn: '2026-11-10', priority: 'p9' } });
    const dd = d1.issue.details;
    T.check('logged with its details: severity, environment, the release it was found in, the customer and their ticket, raised on; who raised it (by default the person); a bad email or choice left out',
      d1.ok && dd.severity === 'major' && dd.severityLabel === 'S2 · Major' && dd.environment === 'UAT' && dd.foundIn === '26C' && dd.customer === 'Acme Rentals' && dd.customerRef === 'INC-1042'
      && dd.raisedOn === '2026-11-10' && dd.reportedBy === 'Asha' && dd.reporterEmail === '' && dd.priority === '', JSON.stringify(dd));
    const w2 = await st2.format(d1.issue.id, { by: 'Asha' });
    T.check('written up: the AI suggests severity and priority only where nobody chose (priority P1; the severity Asha chose kept), marked as the AI\'s, with why',
      w2.ok && w2.issue.details.severity === 'major' && w2.issue.details.priority === 'p1' && w2.issue.details.ai.join() === 'priority' && /every customer/.test(w2.issue.details.aiWhy)
      && /suggests P1 · Urgent/.test(w2.issue.events[w2.issue.events.length - 1].detail), JSON.stringify(w2.issue.details));
    const dc = st2.details(d1.issue.id, { priority: 'p2', assignee: 'Ben', reporterEmail: 'pat@acme.example', fixVersion: '26D', dueDate: '2026-11-30', kind: 'change' }, { by: 'Ben' });
    T.check('its details changed at any stage: each change in its history (P1 → P2, the type), no longer the AI\'s once set', dc.ok && dc.issue.details.priority === 'p2' && dc.issue.details.ai.length === 0 && dc.issue.kind === 'change'
      && /Type: bug → change; Priority: P1 · Urgent → P2 · High;[\s\S]*Assignee: — → Ben/.test(dc.issue.events[dc.issue.events.length - 1].detail), dc.issue.events[dc.issue.events.length - 1].detail);
    T.check('…nothing changed: nothing recorded', st2.details(d1.issue.id, { priority: 'p2' }, { by: 'Ben' }).unchanged === true);
    T.check('a comment with no words: refused', !(await st2.comment(d1.issue.id, { text: '  ', by: 'Ben' })).ok);
    await st2.comment(d1.issue.id, { text: 'I can reproduce it on UAT.', by: 'Ben' });
    const rsp = await st2.comment(d1.issue.id, { text: 'We found it: a fix comes in 26D.', kind: 'response', email: true, by: 'Asha' });
    const mailTo = sent.filter((m) => m.to)[0];
    const note = await st2.comment(d1.issue.id, { text: 'Credit notes come from the AR feed.', kind: 'internal', by: 'Chen' });
    T.check('its discussion: several people, each word with who and when, at which stage; a response to the customer emailed to the reporter', note.ok && note.issue.comments.length === 3
      && note.issue.comments.map((c) => c.by + ':' + c.kind).join() === 'Ben:comment,Asha:response,Chen:internal' && note.issue.comments[1].kindLabel === 'Response to the customer'
      && rsp.issue.comments[1].email.sent && mailTo.to === 'pat@acme.example' && /\[BR-[A-Z0-9]+\] Totals wrong/.test(mailTo.subject) && /a fix comes in 26D/.test(mailTo.html) && note.issue.comments[0].stage === 'Written up');
    const L2 = st2.list({ q: 'acme' });
    T.check('the list: found by its customer; its columns (severity, priority, environment, releases, customer, raised by/on, assignee, comments)', L2.issues.length === 1 && L2.issues[0].severityLabel === 'S2 · Major'
      && L2.issues[0].priorityLabel === 'P2 · High' && L2.issues[0].foundIn === '26C' && L2.issues[0].fixVersion === '26D' && L2.issues[0].customerRef === 'INC-1042' && L2.issues[0].raisedOn === '2026-11-10'
      && L2.issues[0].assignee === 'Ben' && L2.issues[0].comments === 3 && st2.list({ q: 'INC-1042' }).issues.length === 1, JSON.stringify(L2.issues[0]));
    const j403 = await st2.toJira(d1.issue.id, { by: 'Asha' });
    T.check('Jira refusing (403) says why and what to do: the account, the project, the permission', !j403.ok && /Jira refused \(HTTP 403\): the connected account \(javeed@example\.com\) may not do this in project EQP[\s\S]*Create issues/.test(j403.error), j403.error);
    T.check('…the project key set here (checked)', !st2.setSettings({ project: 'bad key!' }).ok && st2.setSettings({ project: 'rite' }).project === 'RITE' && st2.settings().project === 'RITE');
    await st2.toJira(d1.issue.id, { by: 'Asha' });
    const made = sent.filter((x) => x.url && /\/rest\/api\/2\/issue$/.test(x.url)).pop();
    T.check('…and the issue for Jira goes to that project, its details as a table in its description', made.body.fields.project.key === 'RITE' && /\|\|Severity\|S2 · Major\|/.test(made.body.fields.description)
      && /\|\|Customer ticket\|INC-1042\|/.test(made.body.fields.description));
    const tri = await st2.close(d1.issue.id, { by: 'Asha', resolution: 'duplicate', note: 'Same as BR-1' });
    T.check('closed as a duplicate (a resolution chosen), the reason kept; closing twice refused', tri.ok && tri.issue.resolution.code === 'duplicate' && tri.issue.resolutionLabel === 'Duplicate' && tri.issue.resolution.fixedIn === ''
      && !(await st2.close(d1.issue.id, { by: 'Asha' })).ok);
    const ro = st2.reopen(d1.issue.id, { by: 'Ben' });
    T.check('reopened: no resolution any more; its discussion kept', ro.ok && !ro.issue.resolution && ro.issue.comments.length === 3);

    T.section('two PCs answering at once');
    const base = { id: 'isx', status: 'written', updatedAt: '2026-11-13T10:00:00Z', comments: [{ id: 'c1', at: '2026-11-13T09:00:00Z', by: 'Asha', text: 'a' }], events: [{ at: '1', what: 'logged', by: 'Asha' }] };
    const pcA = Object.assign({}, base, { updatedAt: '2026-11-13T10:05:00Z', comments: base.comments.concat([{ id: 'c2', at: '2026-11-13T10:05:00Z', by: 'Ben', text: 'b' }]), events: base.events.concat([{ at: '2', what: 'commented', by: 'Ben' }]) });
    const pcB = Object.assign({}, base, { status: 'analyzed', updatedAt: '2026-11-13T10:06:00Z', comments: base.comments.concat([{ id: 'c3', at: '2026-11-13T10:06:00Z', by: 'Chen', text: 'c' }]), events: base.events.concat([{ at: '3', what: 'analyzed', by: 'AI' }]) });
    const mg = IS.mergeIssue(pcA, pcB);
    T.check('merged: the later state, and both people\'s comments and steps (none lost, none twice)', mg.status === 'analyzed' && mg.comments.map((c) => c.id).join() === 'c1,c2,c3' && mg.events.map((e) => e.what).join() === 'logged,commented,analyzed');
    const DB = require('../desktop/lib/dataBranch');
    const merged = JSON.parse(DB.open({ root: tmp }).resolve('issues/isx.json', JSON.stringify(pcA), JSON.stringify(pcB)));
    T.check('…and so on the data branch: a conflicted issue file keeps both comments', merged.comments.length === 3 && merged.status === 'analyzed');
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
  T.report();
})();
