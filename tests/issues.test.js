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

    T.section('log, the AI writes it up, into Jira');
    const c1 = await store.create({ page: ID, text: 'overdue invoices are all mixed up on my billing, please fix', kind: 'bug', images: [{ name: 'Pasted image 1', mime: 'image/png', base64: PNG }], by: 'Asha' });
    const is1 = c1.issue;
    T.check('logged against the page, a key of its own, its screenshot kept', c1.ok && /^BR-[A-Z0-9]{5}$/.test(is1.key) && is1.label === 'My Billing' && is1.status === 'new' && is1.images.length === 1 && store.img(is1.id, 1).ok
      && is1.steps.length === 7 && is1.steps[0].state === 'now', JSON.stringify([c1.error, is1 && is1.key]));
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
    const cl = await store.close(is1.id, { by: 'Asha', note: 'merged' });
    T.check('closed: the last step done, its timeline from logged to closed', cl.ok && cl.issue.status === 'closed' && cl.issue.steps.every((x) => x.state === 'done')
      && ['logged', 'written up', 'created in Jira', 'analyzed', 'sent for approval', 'approved', 'agent started', 'applied on a branch', 'pull request ready', 'closed'].every((w) => cl.issue.events.some((e) => e.what === w)), JSON.stringify(cl.issue.events.map((e) => e.what)));

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
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
  T.report();
})();
