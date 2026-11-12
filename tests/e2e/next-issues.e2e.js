#!/usr/bin/env node
'use strict';
/**
 * Build.Rite's Issues screen, end to end in the browser, on a sandbox project (a git repository whose pushes go to a
 * bare one; its address GitHub's, so the pull request's address is made), with stand-ins for the AI, Microsoft 365 and
 * Jira: log an issue (its page picked, a screenshot pasted, into Jira) → the AI's write-up → Analyze (the verdict, the
 * exact change with the issue's number) → Send for approval (the email) → Approve → Apply change (the agent's branch,
 * tested, pushed, the pull request) → Close. The project's own checkout is never touched. Needs npm run build.
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
      if (/^You write up software issues/.test(req.system)) return { ok: true, provider: 'Stand-in AI', text: '{"title": "Overdue invoices are not shown first on My Billing", "summary": "Overdue invoices are mixed with the others.", "steps": ["Open My Billing", "Look at the list"], "expected": "Overdue first", "actual": "Mixed", "impact": "Customers miss overdue invoices", "kind": "bug", "questions": ["Which customer saw it?"]}' };
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
    fdd: { pick: () => 'FDD 7.4 Billing: overdue invoices are listed first.' } });
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
    await page.click('#isCreate');
    await page.waitForSelector('#isIssue', { timeout: 20000 });
    await page.waitForFunction(() => /EQP-901/.test((document.getElementById('isKey') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('logged, written up by the AI (its questions shown), created in Jira: EQP-901', /EQP-901/.test(await text(page, '#isKey')) && /Written up/.test(await text(page, '#isStatus'))
      && (await page.inputValue('#isEditTitle')) === 'Overdue invoices are not shown first on My Billing' && /Which customer saw it/.test(await text(page, '#isQuestions'))
      && (await page.inputValue('#isEditSteps')) === 'Open My Billing\nLook at the list' && jiraCalls.some((c) => /\/issue$/.test(c.url)) && (asked[0].images || []).length === 1,
      JSON.stringify([await page.inputValue('#isEditTitle').catch(() => '?'), await text(page, '#isQuestions'), await page.inputValue('#isEditSteps').catch(() => '?'), jiraCalls.length, (asked[0].images || []).length, await text(page, '#isStatus')]));
    T.check('its flow: Logged ✓, Written up now', /Logged\s*Written up\s*Analyzed\s*Approval\s*Applied\s*Pull request\s*Closed/.test(await text(page, '#isSteps'))
      && (await page.$$('#isSteps .nx-is-step--done')).length === 1 && /Written up/.test(await text(page, '#isSteps .nx-is-step--now')));
    await env.shot('issues-written.png');

    T.section('analyze: the verdict and the exact change');
    await page.click('#isAnalyze');
    await page.waitForSelector('#isVerdict', { timeout: 20000 });
    T.check('the verdict: Fix on this page, why; the change with the EQP-901 comment; checks ✓', /Fix on this page\s*the list is not sorted/.test(await text(page, '#isVerdict')) && /<!-- EQP-901: overdue invoices first -->/.test(await text(page, '#isDiff .nx-fx-l--add'))
      && (await page.$$('#isChecks .nx-fx-check--ok')).length >= 5 && /FDD 7\.4/.test(asked[asked.length - 1].user) && /THIS IS ISSUE EQP-901/.test(asked[asked.length - 1].system),
      JSON.stringify([await text(page, '#isVerdict'), (await text(page, '#isDiff .nx-fx-l--add')).slice(0, 80), (await page.$$('#isChecks .nx-fx-check--ok')).length, /FDD 7\.4/.test(asked[asked.length - 1].user), /THIS IS ISSUE EQP-901/.test(asked[asked.length - 1].system)]));

    T.section('approval: sent (an email), approved');
    T.check('Send for approval, by email to me', await page.isChecked('#isEmailMe') && /Email it to priya@example\.com/.test(await text(page, '#isApproval')));
    await page.click('#isAsk');
    await page.waitForSelector('#isAwaiting', { timeout: 10000 });
    T.check('waiting for approval; the email sent (its subject with the key and code)', /Waiting for approval/.test(await text(page, '#isStatus')) && /Approval email sent to priya@example\.com \(code BR-/.test(await text(page, '#isEmailNote'))
      && /^\[Build\.Rite\] Approve EQP-901 · My Billing \(BR-/.test((mails[0] || {}).subject || '') && !(await page.$('#isApply')));
    await env.shot('issues-awaiting.png');
    page.once('dialog', (d) => d.accept());
    await page.click('#isApprove');
    await page.waitForSelector('#isApply', { timeout: 10000 }).catch(() => {});
    T.check('approved (by me, in Build.Rite): Apply change is on', /Approved by priya\.raman · .* in Build\.Rite/.test(await text(page, '#isDecision')) && await page.isEnabled('#isApply'), await text(page, '#isDecision'));

    T.section('the agent applies it: its own branch, tested, pushed, the pull request');
    page.once('dialog', (d) => d.accept());
    await page.click('#isApply');
    await page.waitForSelector('#isBranch', { timeout: 60000 }).catch(() => {});
    T.check('on fix/EQP-901, pushed; tested; the pull request to open', /On fix\/EQP-901 · [0-9a-f]+ · pushed/.test(await text(page, '#isBranch')) && /Nothing broke/.test(await text(page, '#isTests'))
      && /^https:\/\/github\.com\/acme\/equiprite\/compare\/pages%2Ftest\.\.\.fix%2FEQP-901\?expand=1/.test((await page.getAttribute('#isPr', 'href')) || ''), await text(page, '#isBranch'));
    T.check('the branch on the remote has the change; the project\'s checkout is untouched', /EQP-901: overdue invoices first/.test(pg.gitRemote('show', 'fix/EQP-901:' + BILL + '.html'))
      && fs.readFileSync(path.join(pg.root, BILL + '.html'), 'utf8') === html0 && /^EQP-901: Overdue invoices/.test(pg.gitRemote('log', '-1', '--format=%s', 'fix/EQP-901')));
    T.check('its flow: at Pull request', /Pull request/.test(await text(page, '#isSteps .nx-is-step--now')) && /Pull request/.test(await text(page, '#isStatus')));
    await env.shot('issues-applied.png');
    await page.click('#isClose');
    await page.waitForFunction(() => /Closed/.test((document.getElementById('isStatus') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('closed; its history from logged to closed; Jira told at each step', /Closed/.test(await text(page, '#isStatus')) && /logged[\s\S]*written up[\s\S]*created in Jira[\s\S]*analyzed[\s\S]*sent for approval[\s\S]*approved[\s\S]*applied on a branch[\s\S]*pull request ready[\s\S]*closed/.test(await text(page, '#isTimeline'))
      && jiraCalls.filter((c) => /\/comment$/.test(c.url)).length >= 4);
    T.check('the list: the issue, closed', /EQP-901[\s\S]*Closed/.test(await text(page, '#isRows')) || (await page.click('#isFilters [data-key="all"]'), /EQP-901[\s\S]*Closed/.test(await text(page, '#isRows'))));
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
