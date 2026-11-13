#!/usr/bin/env node
'use strict';
/**
 * Build.Rite's Issues screen, end to end in the browser, on a sandbox project (a git repository whose pushes go to a
 * bare one; its address GitHub's, so the pull request's address is made), with stand-ins for the AI, Microsoft 365 and
 * Jira: log an issue (its page picked, a screenshot pasted, into Jira) → the AI's write-up → Analyze (the verdict, the
 * exact change with the issue's number) → Send for approval (the email) → Approve → Apply change (the agent's branch,
 * tested, pushed, the pull request) → Verify (in UAT) → Close with its resolution. Its details (severity, customer, the
 * release it was found in…), the AI's priority, the clickable train, the Next step bar, the discussion (a comment, a
 * response emailed to the customer), the table of every issue. The project's own checkout is never touched. Needs npm run build.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
const BILL = 'webApps/vbredwoodapp/flows/customer-portal/pages/customer-my-billing-page';

(async () => {
  const pg = await E.pagesSandbox({});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-issues-e2e-'));
  const gitIn = (...args) => require('child_process').execFileSync('git', args, { cwd: pg.root, encoding: 'utf8' }).trim();
  gitIn('remote', 'set-url', 'origin', 'https://github.com/acme/equiprite.git');
  gitIn('remote', 'set-url', '--push', 'origin', pg.remote);
  // a real project: it can be built (the sandbox builds it with Oracle's build tool)
  const ROOT = path.join(__dirname, '..', '..');
  fs.copyFileSync(path.join(ROOT, 'visual-application.json'), path.join(pg.root, 'visual-application.json'));
  fs.writeFileSync(path.join(pg.root, '.gitignore'), 'build/\n');
  gitIn('add', '-A'); gitIn('commit', '-q', '-m', 'buildable'); gitIn('push', '-q', 'origin', 'pages/test');
  // the app as it is now (this project's own build of Old EquipRite), and each sandbox's own server
  const { createDevServer } = require('../../desktop/lib/devserver');
  const current = await createDevServer({ buildDir: path.join(ROOT, 'build'), webApp: 'vbredwoodapp', port: 0, getIdentity: () => ({ username: 'priya.raman' }) });
  const sbServers = [];
  let env = null;
  const html0 = fs.readFileSync(path.join(pg.root, BILL + '.html'), 'utf8');
  const lines = html0.replace(/\r\n/g, '\n').split('\n');
  const asked = [];
  const ai = {
    settings: () => ({ active: 'x', catalog: [{ id: 'x', label: 'Stand-in AI' }] }),
    chat: async (req) => {
      asked.push(req);
      if (/^You write short, clear, polite emails/.test(req.system)) return { ok: true, provider: 'Stand-in AI', text: '{"subject": "More information on My Billing", "body": "Hello Pat,\\n\\nWhich customer saw it?\\n\\nThanks, Priya"}' };
      if (/^You write up software issues/.test(req.system)) return { ok: true, provider: 'Stand-in AI', text: '{"title": "Overdue invoices are not shown first on My Billing", "summary": "Overdue invoices are mixed with the others.", "steps": ["Open My Billing", "Look at the list"], "expected": "Overdue first", "actual": "Mixed", "impact": "Customers miss overdue invoices", "kind": "bug", "questions": ["Which customer saw it?"], "severity": "critical", "priority": "p2", "why": "Customers see wrong overdue amounts."}' };
      return { ok: true, provider: 'Stand-in AI', text: ['## Verdict', 'Fix on this page — the list is not sorted by due date.', '## Summary', 'Sort overdue invoices first.', '## How it works today', '`BilledRequestInitChain` loads them.',
        '## What is wrong', 'No sort.', '## The change', '- the page', '## After the change', 'Overdue first.', '## Risks', 'None known', '## How to test', '1. Open My Billing.', '## Questions', 'None', '',
        'FILE: ' + BILL + '.html', '<<<<<<< SEARCH', lines.slice(1, 3).join('\n'), '=======', lines.slice(1, 3).join('\n') + '\n  <!-- EQP-901: overdue invoices first -->', '>>>>>>> REPLACE'].join('\n') };
    },
  };
  const mails = [];
  const jiraCalls = [];
  const fixStore = require('../../desktop/lib/codeFix').open({ root: pg.root, file: path.join(dir, 'code-fixes.json'), ai: ai,
    serveSandbox: async (s) => { const srv = await createDevServer({ buildDir: s.buildDir, repoRoot: s.dir, webApp: s.webApp, port: 0, getIdentity: () => ({ username: 'priya.raman' }) }); sbServers.push(srv); return srv; },
    appUrl: () => current.url,
    // the desktop app's hidden-window screenshot, here a tab of the test's browser
    capture: async (webApp, url, base) => {
      const p2 = await env.page.context().browser().newPage({ viewport: { width: 1440, height: 900 } });
      try { await p2.goto(String(base || current.url).replace(/\/$/, '') + url, { timeout: 20000 }).catch(() => {}); await p2.waitForTimeout(800); const buf = await p2.screenshot({ type: 'jpeg', quality: 60 }); return { ok: true, base64: buf.toString('base64'), mime: 'image/jpeg' }; } finally { await p2.close(); }
    } });
  const issuesStore = require('../../desktop/lib/issues').open({ file: path.join(dir, 'issues.json'), ai: ai, fix: fixStore,
    mail: { status: () => ({ signedIn: true, account: 'priya@example.com' }), sendMail: async (m) => { mails.push(m); return { ok: true }; } },
    jira: { auth: () => ({ site: 'https://example.atlassian.net', header: 'Basic x' }), fetch: async (url, init) => { jiraCalls.push({ url: url, body: init.body ? JSON.parse(init.body) : null });
      return { ok: true, status: 201, text: async () => (/\/issue$/.test(url) ? JSON.stringify({ key: 'EQP-901' }) : '{}') }; } },
    fdd: { pick: () => 'FDD 7.4 Billing: overdue invoices are listed first.' }, pages: pg.store });
  // the page has a screenshot in Application pages already: the Analyzed step shows it, and the AI sees it
  pg.store.saveShot('vbredwoodapp/customer-portal/customer-my-billing', { base64: PNG, mime: 'image/png', source: 'upload', caption: 'The billing list', by: 'priya.raman' });
  env = await E.start({ port: 19900, app: 'next', product: 'buildrite', pagesStore: pg.store, fixStore: fixStore, issuesStore: issuesStore });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('Build.Rite opens on Issues; log an issue');
    await env.open('/');
    await page.waitForSelector('#isNewBtn', { timeout: 30000 });
    await page.waitForFunction(() => !document.getElementById('isNewBtn').disabled, null, { timeout: 15000 }).catch(() => {});
    const first = await page.$eval('.nx-tab', (t) => t.getAttribute('data-tab-id')).catch(() => '');
    T.check('Issues is Build.Rite\'s first screen; nothing chosen yet', first === 'issues' && /Choose an issue, or Log an issue/.test(await text(page, '#isMain')), first);
    await page.click('#isNewBtn');
    await page.waitForSelector('#isBuilds .nx-chip', { timeout: 5000 }).catch(() => {});
    T.check('Log an issue: the build first — its pages only once it is chosen', !!(await page.$('#isPickBuildFirst')) && !(await page.$('#isPageQ')) && (await page.$$('#isBuilds .nx-chip')).length === 5,
      JSON.stringify([!!(await page.$('#isPickBuildFirst')), !!(await page.$('#isPageQ')), (await page.$$('#isBuilds .nx-chip')).length]));
    await page.click('#isBuilds [data-value="vbredwoodapp"]');
    await page.waitForSelector('#isPageList .nx-is-pickrow', { timeout: 5000 });
    const browse = await page.$$eval('#isPageList .nx-is-pickrow', (r) => r.map((x) => x.textContent));
    T.check('…Old EquipRite chosen: its pages listed to browse (nothing typed), only its own', browse.length > 10 && browse.every((t) => /Old EquipRite/.test(t)), browse.length + ' ' + browse.slice(0, 2).join(' | '));
    await page.fill('#isPageQ', 'My Billing');
    await page.waitForSelector('#isPageList .nx-is-pickrow', { timeout: 5000 });
    await page.click('#isPageList .nx-is-pickrow:has-text("customer-portal/customer-my-billing")');
    T.check('the page found by its name and picked', /My Billing\s*Old EquipRite · customer-portal\/customer-my-billing/.test(await text(page, '#isPicked')));
    await page.fill('#isText', 'overdue invoices are all mixed up on my billing');
    await page.evaluate((b64) => {
      const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([bytes], 'image.png', { type: 'image/png' }));
      document.getElementById('isText').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, PNG);
    await page.waitForSelector('#isImgs .nx-fx-img', { timeout: 5000 }).catch(() => {});
    T.check('a screenshot pasted into it; "Create it in Jira too" offered (Jira connected) and ticked', (await page.$$('#isImgs .nx-fx-img')).length === 1 && await page.isChecked('#isToJira'));
    // its details, as any defect record: severity chosen, priority left to the AI; the customer, its ticket, the release
    await page.click('#isNewDetails [data-field="severity"][data-value="major"]');
    await page.click('#isNewDetails [data-field="environment"][data-value="UAT"]');
    await page.fill('#isDFoundIn', '26C');
    await page.fill('#isDCustomer', 'Acme Rentals');
    await page.fill('#isDCustRef', 'INC-1042');
    await page.fill('#isDEmail', 'pat@acme.example');
    await page.fill('#isDNotify', 'lead@acme.example, qa@rite.example, oops');
    T.check('its Notify list: an address per chip, a wrong one marked', (await page.$$('#isNewDetails .nx-is-mail')).length === 3 && (await text(page, '#isNewDetails .nx-is-mail--bad')) === 'oops');
    await page.fill('#isDNotify', 'lead@acme.example, qa@rite.example');
    T.check('its details in the form: severity S2 chosen, UAT, raised on today by default', /S2 · Major/.test(await text(page, '#isNewDetails .nx-chip--on')) && (await page.inputValue('#isDRaisedOn')).length === 10);
    await page.click('#isCreate');
    await page.waitForSelector('#isIssue', { timeout: 20000 });
    await page.waitForFunction(() => /EQP-901/.test((document.getElementById('isKey') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('logged, written up by the AI (its questions shown), created in Jira: EQP-901', /EQP-901/.test(await text(page, '#isKey')) && /Written up/.test(await text(page, '#isStatus'))
      && (await page.inputValue('#isEditTitle')) === 'Overdue invoices are not shown first on My Billing' && /Which customer saw it/.test(await text(page, '#isQuestions'))
      && (await page.inputValue('#isEditSteps')) === 'Open My Billing\nLook at the list' && jiraCalls.some((c) => /\/issue$/.test(c.url)) && (asked[0].images || []).length === 1,
      JSON.stringify([await page.inputValue('#isEditTitle').catch(() => '?'), await text(page, '#isQuestions'), await page.inputValue('#isEditSteps').catch(() => '?'), jiraCalls.length, (asked[0].images || []).length, await text(page, '#isStatus')]));
    T.check('its build, first in its head: Old EquipRite', (await text(page, '#isApp')) === 'Old EquipRite');
    T.check('its severity (S2, as chosen), the AI\'s priority (P2: Asha left it empty); customer and release under the title', (await text(page, '#isSev')) === 'S2 · Major' && (await text(page, '#isPri')) === 'P2 · High'
      && /customer Acme Rentals \(INC-1042\) · found in 26C on UAT/.test(await text(page, '.nx-is-meta')), await text(page, '.nx-is-meta'));
    T.check('its train: Logged ✓, Written up now — through Verified and Closed', /Logged\s*Written up\s*Analyzed\s*Approval\s*Applied\s*Pull request\s*Verified\s*Closed/.test(await text(page, '#isSteps'))
      && (await page.$$('#isSteps .nx-is-step--done')).length === 1 && /Written up/.test(await text(page, '#isSteps .nx-is-step--now')));
    T.check('the Next step bar says what comes after the write-up, with its button', /Next: check the write-up[\s\S]*the AI reads the page's code and the FDD/.test(await text(page, '#isNextText')) && (await text(page, '#isNextBtn')) === 'Analyze with AI');
    await env.shot('issues-written.png');

    T.section('the train: each step its own fields');
    await page.click('#isSteps [data-key="0"]');
    await page.waitForSelector('#isDetails', { timeout: 5000 });
    T.check('Logged: as raised, and every detail (the AI\'s priority marked, with why)', /overdue invoices are all mixed up/.test(await text(page, '#isRaw')) && (await page.inputValue('#isCustomer')) === 'Acme Rentals'
      && /P2 · High/.test(await text(page, '#isDetPri .nx-chip--on')) && /AI/.test(await text(page, '#isDetails .nx-is-aimark')) && /Customers see wrong overdue amounts/.test(await text(page, '#isAiWhy'))
      && /Back to where it is \(Written up\)/.test(await text(page, '#isBackToNow')));
    await page.fill('#isAssignee', 'Ben');
    await page.fill('#isFixVersion', '26D');
    await page.click('#isSaveDetails');
    await page.waitForFunction(() => /Details saved/.test((document.getElementById('isResult') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('…changed and saved: the same step stays; the change in its history', /Details saved/.test(await text(page, '#isResult')) && !!(await page.$('#isDetails')) && /details changed[\s\S]*Assignee: — → Ben/.test(await text(page, '#isTimeline')));
    await page.click('#isSteps [data-key="3"]');
    T.check('Approval, before the analysis: says when it comes', /Approval comes once the analysis proposes a change/.test(await text(page, '#isNoApproval')));
    await env.shot('issues-train.png');

    T.section('the discussion');
    await page.fill('#isCText', 'Seen by Acme on their October invoices.');
    await page.click('#isPost');
    await page.waitForFunction(() => document.querySelectorAll('#isComments .nx-is-cmt').length === 1, null, { timeout: 8000 }).catch(() => {});
    await page.click('#isCKinds [data-value="response"]');
    await page.fill('#isCText', 'Thanks, we found it: a fix is on its way in 26D.');
    await page.check('#isCEmail');
    await page.click('#isPost');
    await page.waitForFunction(() => document.querySelectorAll('#isComments .nx-is-cmt').length === 2, null, { timeout: 8000 }).catch(() => {});
    const mailR = mails.filter((m) => m.to === 'pat@acme.example')[0];
    T.check('a comment, then a response to the customer emailed to the reporter; each with who, which kind, at which step', /priya\.raman\s*Comment · at Written up[\s\S]*Seen by Acme[\s\S]*Response to the customer · at Written up[\s\S]*a fix is on its way[\s\S]*Emailed to pat@acme\.example/.test(await text(page, '#isComments'))
      && !!mailR && /\[EQP-901\]/.test(mailR.subject) && (await page.inputValue('#isCText')) === '' && jiraCalls.some((c) => /Response to the customer/.test((c.body || {}).body || '')), await text(page, '#isComments'));

    T.section('a follow-up email: drafted by the AI, sent, kept in the discussion');
    await page.click('#isEmailBtn');
    await page.waitForSelector('#isMailForm', { timeout: 5000 });
    T.check('Email: to its Notify list and the reporter, its key and title in the subject', (await page.inputValue('#isETo')) === 'lead@acme.example, qa@rite.example, pat@acme.example'
      && (await page.inputValue('#isESubject')) === '[EQP-901] Overdue invoices are not shown first on My Billing', await page.inputValue('#isETo'));
    await page.click('#isDraft');
    await page.waitForFunction(() => /Which customer saw it/.test((document.getElementById('isCText') || {}).value || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('…drafted by the AI from its questions (nothing sent yet)', /Which customer saw it/.test(await page.inputValue('#isCText')) && (await page.inputValue('#isESubject')) === '[EQP-901] More information on My Billing'
      && !mails.some((m) => /More information/.test(m.subject)));
    await page.fill('#isECc', 'boss@rite.example');
    await page.click('#isSendEmail');
    await page.waitForFunction(() => document.querySelectorAll('#isComments .nx-is-cmt').length === 3, null, { timeout: 8000 }).catch(() => {});
    const fu = mails.filter((m) => /More information/.test(m.subject))[0];
    T.check('…sent (to, cc), and kept in the discussion as an email with its subject', !!fu && fu.to === 'lead@acme.example;qa@rite.example;pat@acme.example' && fu.cc === 'boss@rite.example'
      && /Email · at Written up[\s\S]*\[EQP-901\] More information on My Billing[\s\S]*Sent to lead@acme\.example, qa@rite\.example, pat@acme\.example · cc boss@rite\.example/.test(await text(page, '#isComments')), await text(page, '#isComments'));
    await page.click('#isBackToNow');

    T.section('analyze: the verdict and the exact change');
    await page.click('#isNextBtn');
    await page.waitForSelector('#isVerdict', { timeout: 20000 });
    T.check('the verdict: Fix on this page, why; the change with the EQP-901 comment; checks ✓', /Fix on this page\s*the list is not sorted/.test(await text(page, '#isVerdict')) && /<!-- EQP-901: overdue invoices first -->/.test(await text(page, '#isDiff .nx-fx-l--add'))
      && (await page.$$('#isChecks .nx-fx-check--ok')).length >= 5 && /FDD 7\.4/.test(asked[asked.length - 1].user) && /THIS IS ISSUE EQP-901/.test(asked[asked.length - 1].system),
      JSON.stringify([await text(page, '#isVerdict'), (await text(page, '#isDiff .nx-fx-l--add')).slice(0, 80), (await page.$$('#isChecks .nx-fx-check--ok')).length, /FDD 7\.4/.test(asked[asked.length - 1].user), /THIS IS ISSUE EQP-901/.test(asked[asked.length - 1].system)]));
    T.check('the Analyzed step shows the page: its screenshot from Application pages, the build it was found in, its technical sheet; the AI saw the screenshot',
      (await page.$$('#isPageCard .nx-is-shot img')).length === 1 && /Found in 26C on UAT · to be fixed in 26D/.test(await text(page, '#isPageBuild')) && /action chains/.test(await text(page, '#isPageCounts'))
      && (asked[asked.length - 1].images || []).length === 2 && /the page as it looks now, from Application pages; the others came with the issue/.test(asked[asked.length - 1].user),
      JSON.stringify([(await page.$$('#isPageCard .nx-is-shot img')).length, await text(page, '#isPageBuild'), (asked[asked.length - 1].images || []).map((im) => im.name), /the page as it looks now/.test(asked[asked.length - 1].user), await text(page, '#isNoShot')]));
    await env.shot('issues-analyzed.png');
    await page.waitForTimeout(300);
    const an = mails.filter((m) => /\] Analyzed · /.test(m.subject))[0];
    T.check('its status changed: everyone on the Notify list emailed (and the history says so)', !!an && an.to === 'lead@acme.example;qa@rite.example' && /Written up → Analyzed/.test(an.html)
      && /status sent to the Notify list[\s\S]*Analyzed · emailed to lead@acme\.example, qa@rite\.example/.test(await text(page, '#isTimeline')), JSON.stringify(an && an.to));
    T.check('…and the Next step: Send for approval, emailed to me', /send the proposed change for approval — emailed to priya@example\.com/.test(await text(page, '#isNextText')) && (await text(page, '#isNextBtn')) === 'Send for approval');

    T.section('the sandbox: the fix tried first, in a copy of the code, before anyone approves it');
    T.check('the Analyzed step offers it: what it does, your own folder untouched', /Try it in a sandbox/.test(await text(page, '#isSandbox .nx-is-sbhead')) && /copies Old EquipRite's code .* into a folder of its own on this PC, writes this fix there and builds the app/.test(await text(page, '#isSbIntro'))
      && /Your own code folder is not touched; nothing is committed or pushed until it is approved/.test(await text(page, '#isSbIntro')) && await page.isEnabled('#isSbMake'), await text(page, '#isSbIntro'));
    await page.click('#isSbMake');
    await page.waitForSelector('#isSbSteps .nx-is-ag--done', { timeout: 15000 }).catch(() => {});
    T.check('…making it: its steps shown as it goes', !!(await page.$('#isSbMake.nx-btn--working')) || (await page.$$('#isSbSteps .nx-is-ag--done')).length >= 1);
    await page.waitForSelector('#isSbRunBtn', { timeout: 90000 }).catch(() => {});
    await page.waitForSelector('#isSbDiffText .nx-is-sbd--add', { state: 'attached', timeout: 15000 }).catch(() => {}); // what it changed: read from the sandbox (git)
    const sbFolder = await text(page, '#isSbFolder');
    T.check('made: on fix/EQP-901 from origin/pages/test at its commit, built; its folder (sandboxes/fix-EQP-901); the project\'s checkout untouched', /^Sandbox fix\/EQP-901 · from origin\/pages\/test @ [0-9a-f]{7} · made .* by priya\.raman$/.test(await text(page, '#isSbState'))
      && /^Built in \d+ s: ready to run\.$/.test(await text(page, '#isSbBuilt')) && /sandboxes[\\/]fix-EQP-901$/.test(sbFolder) && fs.existsSync(path.join(sbFolder, BILL + '.html'))
      && /EQP-901: overdue invoices first/.test(fs.readFileSync(path.join(sbFolder, BILL + '.html'), 'utf8')) && fs.readFileSync(path.join(pg.root, BILL + '.html'), 'utf8') === html0 && !(await page.$('#isSbRun')), await text(page, '#isSbState') + ' | ' + await text(page, '#isSbBuilt') + ' | ' + sbFolder);
    T.check('…what it changed: the one file; its diff, the added line marked', /What the sandbox changed · 1 file\(s\)/.test(await text(page, '#isSbDiff summary')) && /customer-my-billing-page\.html changed/.test(await text(page, '#isSbFiles'))
      && /<!-- EQP-901: overdue invoices first -->/.test(await text(page, '#isSbDiffText .nx-is-sbd--add')), await text(page, '#isSbDiff summary'));
    T.check('…real data, said: the same services as the app (its Fusion: a DEV instance, not PROD)', /Real data\. Its data: fa-etao-dev20-saasfademo1\.ds-fa\.oraclepdemos\.com — the same services and logins as your EquipRite/.test(await text(page, '#isSbData'))
      && !(await page.$('#isSbData.nx-is-sbdata--prod')), await text(page, '#isSbData'));
    const [sbPop] = await Promise.all([page.waitForEvent('popup', { timeout: 10000 }).catch(() => null), page.click('#isSbRunBtn')]);
    const sbUrl = sbPop ? sbPop.url() : '';
    const sbBase = (/^http:\/\/localhost:\d+/.exec(sbUrl) || [''])[0];
    const sbVer = fs.readdirSync(path.join(sbFolder, 'build', 'processed', 'webApps', 'vbredwoodapp')).filter((n) => /^version_/.test(n))[0];
    const sbPage = sbBase ? await (await fetch(sbBase + '/' + sbVer + '/flows/customer-portal/pages/customer-my-billing-page.html')).text().catch(() => '') : '';
    T.check('Run in sandbox: the app opens from the sandbox (a port of its own), and it serves the page with the fix', !!sbBase && sbBase !== 'http://localhost:19900' && current.url.indexOf(sbBase) !== 0 && /EQP-901: overdue invoices first/.test(sbPage)
      && /The sandbox is open: http:\/\/localhost:\d+/.test(await text(page, '#isResult')), sbUrl + ' | ' + await text(page, '#isResult'));
    if (sbPop) await sbPop.close();
    const [curPop] = await Promise.all([page.waitForEvent('popup', { timeout: 10000 }).catch(() => null), page.click('#isSbRunCur')]);
    const curUrl = curPop ? curPop.url() : '';
    T.check('Run as it is now: the same page, from the app as it is (to compare)', !!curUrl && curUrl.indexOf(current.url.replace(/\/$/, '')) === 0 && curUrl.slice(current.url.replace(/\/$/, '').length) === sbUrl.slice(sbBase.length), curUrl + ' vs ' + sbUrl);
    if (curPop) await curPop.close();
    await page.click('#isSbShotsBtn');
    await page.waitForSelector('#isSbShots #isSbAfter img', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(500);
    T.check('Screenshots: before (as it is now) and after (the sandbox), side by side, kept with the issue', (await page.$$eval('#isSbShots img', (ims) => ims.filter((im) => im.complete && im.naturalWidth > 100).length).catch(() => 0)) === 2
      && /Before · the app as it is now/.test(await text(page, '#isSbBefore')) && /After · the sandbox, with the fix/.test(await text(page, '#isSbAfter')) && /Taken /.test(await text(page, '#isSbShotNote')));
    await page.click('#isSbTestsBtn');
    await page.waitForSelector('#isSbTests', { timeout: 30000 }).catch(() => {});
    T.check('Run its tests: in the sandbox — nothing broke (no unit test names this page yet; the page checks)', /^✓ Nothing broke in the sandbox — no unit test names this page, \d+ page checks/.test(await text(page, '#isSbTests')), await text(page, '#isSbTests'));
    const shotUrl = await page.getAttribute('#isSbAfter img', 'src');
    const otherSite = await fetch(new URL(shotUrl, env.nextUrl).href, { headers: { 'Sec-Fetch-Site': 'cross-site' } }).then((r) => r.status).catch(() => 0);
    T.check('…the screenshots go only to the app\'s own page (refused to another site)', otherSite === 403, String(otherSite));
    await env.shot('issues-sandbox.png');

    T.section('origin moves on: the sandbox is behind; made again, its tests catch what breaks — before approval');
    // the project has Old EquipRite's guard (a stand-in): this change to an Old EquipRite page fails it until agreed
    const GUARD = 'tests/old-app-unchanged.test.js';
    fs.mkdirSync(path.join(pg.root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(pg.root, GUARD), ["const fs = require('fs'), path = require('path');", 'const AGREED = [', "  { why: 'start', paths: [] }", '];',
      "const f = '" + BILL + ".html';", "const changed = /EQP-901: overdue invoices first/.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));",
      'const ok = !changed || AGREED.some((a) => a.paths.indexOf(f) !== -1);', "console.log('passed: ' + (ok ? 1 : 0) + '   failed: ' + (ok ? 0 : 1));",
      "if (!ok) { console.log('FAILURES:'); console.log('  - Old EquipRite changed, not agreed: ' + f); process.exit(1); }"].join('\n') + '\n');
    gitIn('add', GUARD); gitIn('commit', '-q', '-m', 'the guard'); gitIn('push', '-q', 'origin', 'pages/test');
    await page.click('#isSbTestsBtn');
    await page.waitForSelector('#isSbBehind', { timeout: 15000 }).catch(() => {});
    T.check('1 commit behind origin/pages/test: said, with what to do', /^1 commit behind origin\/pages\/test since it was made — make it again to try the fix on the latest code\.$/.test(await text(page, '#isSbBehind')), await text(page, '#isSbBehind'));
    await page.click('#isSbAgain');
    await page.waitForFunction(() => !document.getElementById('isSbBehind') && !!document.getElementById('isSbRunBtn') && !document.querySelector('#isSbAgain.nx-btn--working'), null, { timeout: 90000 }).catch(() => {});
    T.check('…made again: on the latest code (not behind), the guard in it', !(await page.$('#isSbBehind')) && fs.existsSync(path.join(sbFolder, GUARD)) && /sandbox made again/i.test(await text(page, '#isTimeline')), await text(page, '#isSbState'));
    await page.click('#isSbTestsBtn');
    await page.waitForSelector('#isSbTests.nx-is-sbtests--bad', { timeout: 30000 }).catch(() => {});
    T.check('…its tests: Old EquipRite\'s guard breaks — caught in the sandbox, before anyone approves', /^✗ 1 new failure in the sandbox — 1 test file \(passing before: 1\)/.test(await text(page, '#isSbTests'))
      && /tests\/old-app-unchanged\.test\.js: Old EquipRite changed, not agreed/.test(await text(page, '#isSbTests ul')), await text(page, '#isSbTests'));
    await env.shot('issues-sandbox-caught.png');

    T.section('approval: sent (an email), approved');
    await page.click('#isSteps [data-key="3"]');
    T.check('the Approval step: the approver (me by default), by email', await page.isChecked('#isEmailMe') && (await page.inputValue('#isApprover')) === 'priya@example.com' && /Email it to priya@example\.com/.test(await text(page, '#isApproval')));
    await page.click('#isAskBtn');
    await page.waitForSelector('#isAwaiting', { timeout: 10000 });
    T.check('waiting for approval; the email sent (its subject with the key and code)', /Waiting for approval/.test(await text(page, '#isStatus')) && /Approval email sent to priya@example\.com \(code BR-/.test(await text(page, '#isEmailNote'))
      && /^\[Build\.Rite\] Approve EQP-901 · My Billing \(BR-/.test((mails.filter((m) => /Approve/.test(m.subject))[0] || {}).subject || '') && !(await page.$('#isApply')));
    await env.shot('issues-awaiting.png');
    page.once('dialog', (d) => d.accept());
    await page.click('#isNextBtn');
    await page.waitForSelector('#isApply', { timeout: 10000 }).catch(() => {});
    await page.waitForFunction(() => { const b = document.getElementById('isApply'); return !!b && !b.disabled; }, null, { timeout: 15000 }).catch(() => {});
    T.check('approved from the Next step bar (by me, in Build.Rite): Apply change is on', /Approved by priya\.raman · .* in Build\.Rite/.test(await text(page, '#isDecision')) && await page.isEnabled('#isApply') && (await text(page, '#isNextBtn')) === 'Apply change', await text(page, '#isDecision'));

    T.section('the agent applies it: its own branch, tested, pushed, the pull request');
    T.check('before Apply: the exact change it will apply, and what the agent will do (its 9 steps, waiting)', /The change the agent will apply · 1 file · \+1 −0/.test(await text(page, '#isApplyChange summary'))
      && /<!-- EQP-901: overdue invoices first -->/.test(await text(page, '#isApplyChange')) && /What the agent will do on fix\/EQP-901/.test(await text(page, '#isAgentState'))
      && (await page.$$('#isAgentSteps .nx-is-ag--pending')).length === 9 && /Get the latest code[\s\S]*Run the related tests, before the change[\s\S]*Push the branch[\s\S]*The pull request/.test(await text(page, '#isAgentSteps')),
      await text(page, '#isApplyChange summary'));
    await env.shot('issues-before-apply.png');
    page.once('dialog', (d) => d.accept());
    await page.click('#isApply');
    await page.waitForSelector('#isApply.nx-btn--working', { timeout: 3000 }).catch(() => {});
    T.check('…pressed: the button turns (working), the banner says what is happening, pinned in view', !!(await page.$('#isApply.nx-btn--working')) && /The agent is applying it on fix\/EQP-901/.test(await text(page, '#isProgress')));
    await page.waitForSelector('#isAgentSteps .nx-is-ag--done', { timeout: 20000 }).catch(() => {});
    T.check('…its steps shown as it goes', (await page.$$('#isAgentSteps .nx-is-ag--done, #isAgentSteps .nx-is-ag--skipped')).length >= 1);

    T.section('the agent stops on a failing test: why, its full log, the ways on');
    await page.waitForSelector('#isBroke', { timeout: 60000 }).catch(() => {});
    T.check('stopped: which test broke (passed before), its failing line, its output; nothing committed; the button stops turning', /The agent stopped: the change breaks what passed before\. Nothing was committed or pushed\./.test(await text(page, '#isBroke'))
      && /tests\/old-app-unchanged\.test\.js · before the change: passed/.test(await text(page, '#isBroke .nx-is-brokeunit')) && /Old EquipRite changed, not agreed/.test(await text(page, '#isBroke .nx-is-brokelines'))
      && /FAILURES:/.test(await page.$eval('#isBroke .nx-is-brokeout pre', (e) => e.textContent).catch(() => '')) && !(await page.$('#isApply.nx-btn--working')) && !(await page.$('#isBranch'))
      && !(() => { try { return pg.gitRemote('rev-parse', '--verify', '-q', 'fix/EQP-901'); } catch (e) { return ''; } })(), await text(page, '#isBroke'));
    T.check('…the agent\'s header says it stopped, and why (not "Working…")', /^✗ Stopped after \d+ s: The change breaks 1 check\(s\) or test\(s\) on fix\/EQP-901: not committed/.test(await text(page, '#isAgentState')), await text(page, '#isAgentState'));
    T.check('…its steps: the tests after the change failed (✗), what broke named there', !!(await page.$('#isAgentSteps .nx-is-ag--failed')) && /Run the tests again, with the change[\s\S]*1 new failure[\s\S]*old-app-unchanged/.test(await text(page, '#isAgentSteps')), await text(page, '#isAgentSteps'));
    const logTxt = await page.$eval('#isAgent .nx-is-aglogtext', (e) => e.textContent).catch(() => '');
    T.check('…its full log, open when it failed: each line timed, the step, each test file\'s result before (✓) and after (✗), how it ended; scrolled to its newest line', /Its full log · \d+ lines/.test(await text(page, '#isAgent .nx-is-aglog summary'))
      && (await page.getAttribute('#isAgent .nx-is-aglog', 'open')) !== null && /\+\d+:\d\d\s+✓ tests before\s+1 of 1 passing before the change \(when the sandbox was made\)/.test(logTxt)
      && /✓ latest code\s+the sandbox has the code from origin\/pages\/test/.test(logTxt) && /write\s+already in the sandbox/.test(logTxt)
      && /tests after\s+tests\/old-app-unchanged\.test\.js: ✗ 0 passed, 1 failed .* Old EquipRite changed, not agreed/.test(logTxt) && /✗ end /.test(logTxt)
      && await page.$eval('#isAgent .nx-is-aglogtext', (e) => e.scrollHeight <= e.clientHeight + 2 || e.scrollTop + e.clientHeight >= e.scrollHeight - 2), logTxt.slice(0, 1500));
    T.check('…it is Old EquipRite\'s guard: said so, with the ways on (agree it and apply; analyze again with the failure; apply anyway with a reason)', /This is Old EquipRite's guard/.test(await text(page, '#isGuardNote'))
      && await page.isEnabled('#isApplyAgreed') && await page.isEnabled('#isRefineFail') && !!(await page.$('#isAnyReason')) && !(await page.$('#isOldAgree')));
    await page.click('#isApplyAnyway');
    await page.waitForFunction(() => /Say why it may go in/.test(document.body.textContent), null, { timeout: 3000 }).catch(() => {});
    T.check('…applied anyway: not without a reason', /Say why it may go in with the failing test/.test(await text(page, 'body')) && !(await page.$('#isBranch')));
    await env.shot('issues-agent-stopped.png');
    page.once('dialog', (d) => d.accept());
    await page.click('#isApplyAgreed');
    await page.waitForSelector('#isBranch', { timeout: 60000 }).catch(() => {});
    const guardOnBranch = (() => { try { return pg.gitRemote('show', 'fix/EQP-901:' + GUARD); } catch (e) { return ''; } })();
    T.check('agreed for Old EquipRite: the page named in the guard (the issue, who approved it) in the same commit — the guard passes now', /why: 'EQP-901: Overdue invoices are not shown first on My Billing — approved by priya\.raman \(\d{4}-\d\d-\d\d\)'/.test(guardOnBranch) && guardOnBranch.indexOf("'" + BILL + ".html'") !== -1
      && /Agreed for Old EquipRite/.test(pg.gitRemote('log', '-1', '--format=%b', 'fix/EQP-901')) && !(await page.$('#isBroke')), guardOnBranch.slice(0, 400));
    T.check('applied from the sandbox it was tried in; the Pull request step says so, to run it again', /Tried in its sandbox\. Sandbox fix\/EQP-901/.test(await text(page, '#isSbLine')) && fs.existsSync(sbFolder)
      && /EQP-901: overdue invoices first/.test(pg.gitRemote('show', 'fix/EQP-901:' + BILL + '.html')), await text(page, '#isSbLine'));
    T.check('…its log kept, closed when it went well', /Its full log · \d+ lines/.test(await text(page, '#isAgentDone .nx-is-aglog summary')) && (await page.getAttribute('#isAgentDone .nx-is-aglog', 'open')) === null
      && /and agreed for Old EquipRite/.test(await page.$eval('#isAgentDone .nx-is-aglogtext', (e) => e.textContent).catch(() => '')));
    T.check('done: how the agent\'s run went, step by step — committed, pushed, the pull request; the time it took', /✓ Done in \d+ s/.test(await text(page, '#isAgentDone .nx-is-agentstate'))
      && /Commit it[\s\S]*EQP-901: Overdue invoices[\s\S]*Push the branch[\s\S]*to origin\/fix\/EQP-901[\s\S]*The pull request[\s\S]*ready to open/.test(await text(page, '#isAgentDone'))
      && !(await page.$('#isAgentDone .nx-is-ag--failed')) && !(await page.$('#isApply.nx-btn--working')), await text(page, '#isAgentDone'));
    await env.shot('issues-agent-done.png');
    T.check('on fix/EQP-901, pushed; tested; the pull request to open', /On fix\/EQP-901 · [0-9a-f]+ · pushed/.test(await text(page, '#isBranch')) && /Nothing broke/.test(await text(page, '#isTests'))
      && /^https:\/\/github\.com\/acme\/equiprite\/compare\/pages%2Ftest\.\.\.fix%2FEQP-901\?expand=1/.test((await page.getAttribute('#isPr', 'href')) || ''), await text(page, '#isBranch'));
    T.check('the branch on the remote has the change; the project\'s checkout is untouched', /EQP-901: overdue invoices first/.test(pg.gitRemote('show', 'fix/EQP-901:' + BILL + '.html'))
      && fs.readFileSync(path.join(pg.root, BILL + '.html'), 'utf8') === html0 && /^EQP-901: Overdue invoices/.test(pg.gitRemote('log', '-1', '--format=%s', 'fix/EQP-901')));
    T.check('its train: at Pull request; Next: verify the fix in SIT or UAT', /Pull request/.test(await text(page, '#isSteps .nx-is-step--now')) && /Pull request/.test(await text(page, '#isStatus')) && (await text(page, '#isNextBtn')) === 'Verify the fix');
    await env.shot('issues-applied.png');

    T.section('verified, then closed with its resolution');
    await page.click('#isNextBtn');
    await page.waitForSelector('#isVerifyPass', { timeout: 5000 });
    await page.click('#isVEnvs [data-value="UAT"]');
    await page.fill('#isVBuild', '26D.1');
    await page.fill('#isVNotes', 'Overdue invoices come first now.');
    await page.click('#isVerifyPass');
    await page.waitForFunction(() => /Verified/.test((document.getElementById('isStatus') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('verified in UAT on 26D.1 (QA); Next: close it', /Verified/.test(await text(page, '#isStatus')) && (await text(page, '#isNextBtn')) === 'Close it…' && jiraCalls.some((c) => /Verified in UAT on 26D\.1/.test((c.body || {}).body || '')));
    await page.click('#isNextBtn');
    await page.waitForSelector('#isResChips', { timeout: 5000 });
    T.check('the close step: Fixed chosen (a verified bug), fixed in the fix version', /^Fixed$/.test(await text(page, '#isResChips .nx-chip--on')) && (await page.inputValue('#isRFixed')) === '26D');
    await page.click('#isCauseChips [data-value="code"]');
    await page.click('#isClose');
    await page.waitForFunction(() => /Closed/.test((document.getElementById('isStatus') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('closed: its sandbox gone (its folder deleted; the branch kept for the pull request)', !fs.existsSync(sbFolder) && /sandbox removed/.test(await text(page, '#isTimeline')) && /fix\/EQP-901/.test(pg.gitRemote('branch', '--list', 'fix/EQP-901')), await text(page, '#isTimeline').then((t) => t.slice(-300)));
    T.check('closed as Fixed in 26D, root cause Code defect; its history from logged to closed; Jira told at each step', /Closed/.test(await text(page, '#isStatus')) && /Fixed\s*Fixed in\s*26D\s*Root cause\s*Code defect/.test(await text(page, '#isResolution'))
      && /logged[\s\S]*written up[\s\S]*created in Jira[\s\S]*analyzed[\s\S]*sent for approval[\s\S]*approved[\s\S]*applied on a branch[\s\S]*pull request ready[\s\S]*verified[\s\S]*closed/.test(await text(page, '#isTimeline'))
      && jiraCalls.filter((c) => /\/comment$/.test(c.url)).length >= 6, await text(page, '#isResolution'));
    await env.shot('issues-closed.png');
    T.check('the list: the issue, closed', /EQP-901[\s\S]*Closed/.test(await text(page, '#isRows')) || (await page.click('#isFilters [data-key="all"]'), /EQP-901[\s\S]*Closed/.test(await text(page, '#isRows'))));

    T.section('the table: every issue with its columns');
    await page.click('#isLayTable');
    await page.click('#isTFilters [data-key="all"]');
    await page.waitForSelector('#isTable .nx-is-tr:not(.nx-is-tr--head)', { timeout: 5000 });
    const row = await text(page, '#isTable .nx-is-tr:not(.nx-is-tr--head)');
    T.check('its row: key, title, type, severity, priority, status, env, found in, fix version, customer and ticket, raised by and on, assignee, comments, resolution',
      /OLD\s*EQP-901[\s\S]*Overdue invoices are not shown first[\s\S]*bug\s*S2\s*P2\s*Closed\s*UAT\s*26C\s*26D\s*Acme Rentals · INC-1042\s*priya\.raman\s*\d+ \w+ \d{4}\s*Ben\s*—\s*3\s*Fixed/.test(row), row);
    await env.shot('issues-table.png');
    await page.click('#isTable .nx-is-tr:not(.nx-is-tr--head)');
    await page.waitForSelector('#isIssue', { timeout: 5000 });
    T.check('a row opens its issue (back beside the list)', /EQP-901/.test(await text(page, '#isKey')) && !(await page.$('#isTable')));

    T.section('the build in scope (the top bar)');
    T.check('the top bar: All, Old, New, Next, Mobile, Future — All chosen', (await page.$$('#nxScope .nx-scope-btn')).length === 6 && /All/.test(await text(page, '#nxScope .nx-scope-btn--on')));
    await page.click('#nxScope [data-scope="equiprite-future"]');
    await page.waitForFunction(() => /^Future:/.test((document.getElementById('isSub') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    T.check('Future: only its issues (none here); the subtitle says so', /^Future: 0 open · 0 waiting for approval · 0 in review · 0 closed/.test(await text(page, '#isSub')) && !/EQP-901/.test(await text(page, '#isRows')), await text(page, '#isSub'));
    await page.click('#isNewBtn');
    T.check('…a new issue starts in the build in scope (Future), its pages to pick', /Future/.test(await text(page, '#isBuilds .nx-chip--on')) && /pages of Future/.test((await page.getAttribute('#isPageQ', 'placeholder')) || ''));
    await page.click('#nxScope [data-scope="vbredwoodapp"]');
    await page.waitForFunction(() => /^Old EquipRite:/.test((document.getElementById('isSub') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    T.check('Old EquipRite: its issue; kept for next time', /^Old EquipRite: 0 open · 0 waiting for approval · 0 in review · 1 closed/.test(await text(page, '#isSub'))
      && (await page.evaluate(() => localStorage.getItem('eqr.build.scope'))) === 'vbredwoodapp', await text(page, '#isSub'));
    await page.click('#nxScope [data-scope=""]');
    T.eq('no browser errors', errs().join(' | ').slice(0, 1500), '');
  } catch (e) {
    T.check('no exception: ' + (e && e.message), false);
  } finally {
    for (const sv of sbServers.concat([current])) { try { await sv.close(); } catch (e) { /* closed */ } }
    await env.close();
    pg.restore();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
  T.report();
})();
