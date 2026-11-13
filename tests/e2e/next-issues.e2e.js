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
  const fixStore = require('../../desktop/lib/codeFix').open({ root: pg.root, file: path.join(dir, 'code-fixes.json'), ai: ai });
  const issuesStore = require('../../desktop/lib/issues').open({ file: path.join(dir, 'issues.json'), ai: ai, fix: fixStore,
    mail: { status: () => ({ signedIn: true, account: 'priya@example.com' }), sendMail: async (m) => { mails.push(m); return { ok: true }; } },
    jira: { auth: () => ({ site: 'https://example.atlassian.net', header: 'Basic x' }), fetch: async (url, init) => { jiraCalls.push({ url: url, body: init.body ? JSON.parse(init.body) : null });
      return { ok: true, status: 201, text: async () => (/\/issue$/.test(url) ? JSON.stringify({ key: 'EQP-901' }) : '{}') }; } },
    fdd: { pick: () => 'FDD 7.4 Billing: overdue invoices are listed first.' }, pages: pg.store });
  // the page has a screenshot in Application pages already: the Analyzed step shows it, and the AI sees it
  pg.store.saveShot('vbredwoodapp/customer-portal/customer-my-billing', { base64: PNG, mime: 'image/png', source: 'upload', caption: 'The billing list', by: 'priya.raman' });
  const env = await E.start({ port: 19900, app: 'next', product: 'buildrite', pagesStore: pg.store, fixStore: fixStore, issuesStore: issuesStore });
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
    await page.waitForSelector('#isBranch', { timeout: 60000 }).catch(() => {});
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
    await env.close();
    pg.restore();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
  T.report();
})();
