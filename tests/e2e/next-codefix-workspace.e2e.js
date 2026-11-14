/*
 * Code fix in your workspace, in a browser: Application pages and Code fix read a VB Studio workspace's working folder
 * (a worktree on buildrite-working, as the set-up wizard makes it), and a change goes there only — the panel says
 * whose folder it is (no other to pick), approving writes the files there (nothing pulled), "Save in working" commits
 * there (no Commit & push: nothing reaches VB Studio but by Apply to main → Push, in the project's tab), and the
 * project's own checkout and its origin are left as they were.
 *
 * Run:  node tests/e2e/next-codefix-workspace.e2e.js   (after npm run build)
 */
'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');
const E = require('./harness');
const H = require('../_harness');

const T = H.makeAsserter();
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const ID = 'vbredwoodapp/customer-portal/customer-my-billing';
const BILL = 'webApps/vbredwoodapp/flows/customer-portal/pages/customer-my-billing-page';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

(async () => {
  const pg = await E.pagesSandbox({});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-fix-ws-e2e-'));
  // the workspace's working folder: a worktree of the checkout (its main folder), on buildrite-working
  const working = path.join(dir, 'BuildRite', 'rebuild-app-dev-one', 'working');
  git(pg.root, 'worktree', 'add', '-q', '-B', 'buildrite-working', working);
  const ws = { folder: working, label: 'Rebuild App ▸ Dev_One', branch: 'buildrite-working', key: 'acme-dev1/rebuild-app_100010', name: 'Rebuild App', ws: 'Dev_One' };
  const pagesStore = require('../../desktop/lib/pages').open({ root: pg.root, rootFn: () => working, rootLabel: () => 'Rebuild App ▸ Dev_One (dev-one)', spaceFn: () => 'acme-dev1_rebuild-app_100010' });
  const lines = fs.readFileSync(path.join(working, BILL + '.html'), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const mainHtml = fs.readFileSync(path.join(pg.root, BILL + '.html'), 'utf8');
  const remoteHead = pg.gitRemote('rev-parse', 'pages/test');
  const fixStore = require('../../desktop/lib/codeFix').open({ root: pg.root, file: path.join(dir, 'code-fixes.json'), workFn: () => ws, pickFolder: async () => pg.root, ai: {
    settings: () => ({ active: 'x', catalog: [{ id: 'x', label: 'Stand-in AI' }] }),
    chat: async () => ({ ok: true, provider: 'Stand-in AI', model: 'test', text: ['## Summary', 'A note in the header comment.', '## How it works today', 'It lists billed requests.', '## What changes', 'One comment line.',
      '## The change', '- `' + BILL + '.html` — a comment line', '## After the change', 'The same.', '## Risks', 'None known', '## How to test', '1. Open My Billing.', '## Questions', 'None', '',
      'FILE: ' + BILL + '.html', '<<<<<<< SEARCH', lines.slice(1, 3).join('\n'), '=======', lines.slice(1, 3).join('\n') + '\n  Overdue invoices first (workspace fix).', '>>>>>>> REPLACE'].join('\n') }) } });
  const env = await E.start({ port: 19845, app: 'next', pagesStore, fixStore });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  try {
    T.section('the code folder: your workspace\'s working folder');
    await env.open('/?open=app-pages');
    await page.waitForSelector('#pgRows .nx-pg-row[data-id="' + ID + '"]', { timeout: 30000 });
    await page.click('#pgRows .nx-pg-row[data-id="' + ID + '"]');
    await page.waitForSelector('#pgSheetTitle', { timeout: 10000 });
    await page.click('#pgTabFix');
    await page.waitForSelector('#fxRequest', { timeout: 10000 });
    T.check('the panel names your workspace and its working folder (branch buildrite-working), changes on this PC until Apply to main → Push', (await text(page, '#fxFolderPath')) === path.resolve(working)
      && /Your workspace Rebuild App ▸ Dev_One — its working folder, branch buildrite-working/.test(await text(page, '#fxFolder')) && /Apply to main, then Push/.test(await text(page, '#fxFolder')), await text(page, '#fxFolder'));
    T.check('…no other folder to pick', !(await page.$('#fxPick')));
    T.check('the Jira story and issue no. asked with the request (written into the code\'s note)', !!(await page.$('#fxJira')) && !!(await page.$('#fxIssueNo')) && /Written into the code with the change/.test(await text(page, '#fxRefsAsk')));
    await page.fill('#fxJira', 'EQP-123');
    await page.fill('#fxIssueNo', 'ISS-12');
    await page.fill('#fxRequest', 'Show overdue invoices first');
    await page.click('#fxAnalyze');
    await page.waitForSelector('#fxProposal', { timeout: 20000 });
    T.check('proposed; approving says: written in the working folder, nothing pulled, committed or pushed', /Proposed/.test(await text(page, '#fxStatus'))
      && /in your workspace's working folder \(Rebuild App ▸ Dev_One\)/.test(await text(page, '#fxApproveText')) && /Nothing is pulled, committed or pushed/.test(await text(page, '#fxApproveText')) && /A note goes into the code beside the change/.test(await text(page, '#fxApproveText')), await text(page, '#fxApproveText'));
    T.check('…the proposal names its Jira story and issue', (await text(page, '#fxRefs')) === 'Jira story EQP-123 · Issue ISS-12', await text(page, '#fxRefs'));

    T.section('approved: written in the working folder only');
    let asked = '';
    page.once('dialog', (d) => { asked = d.message(); d.accept(); });
    await page.click('#fxApply');
    await page.waitForSelector('#fxApplied', { timeout: 30000 }).catch(() => {});
    T.check('the question names the working folder; nothing pulled', asked.indexOf(path.resolve(working)) !== -1 && /Nothing is pulled, committed or pushed/.test(asked), asked);
    T.check('applied in your workspace\'s working folder (buildrite-working) · nothing pulled; checked', /Applied .* in your workspace's working folder \(buildrite-working\)/.test(await text(page, '#fxAppliedText'))
      && /nothing pulled/.test(await text(page, '#fxApplied')) && /Nothing broke/.test(await text(page, '#fxTests')), await text(page, '#fxApplied'));
    T.check('…the file changed in the working folder; the checkout (main) and its origin as they were', /Overdue invoices first \(workspace fix\)/.test(fs.readFileSync(path.join(working, BILL + '.html'), 'utf8'))
      && fs.readFileSync(path.join(pg.root, BILL + '.html'), 'utf8') === mainHtml && pg.gitRemote('rev-parse', 'pages/test') === remoteHead);
    const wrote = fs.readFileSync(path.join(working, BILL + '.html'), 'utf8');
    T.check('…the change note written in the code (who asked, who changed it, when, the Jira story and issue); said under Applied', /1 change note written in the code beside the change/.test(await text(page, '#fxNotes'))
      && /<!-- Build\.Rite change fx[a-z0-9]+ — My Billing[\s\S]*Request: +Show overdue invoices first[\s\S]*Requested by: priya\.raman on [\s\S]*Changed by: +priya\.raman on [\s\S]*Issue: +ISS-12[\s\S]*Jira story: +EQP-123[\s\S]*?-->/.test(wrote), await text(page, '#fxNotes'));
    T.check('…"Save in working" — no Commit & push', !!(await page.$('#fxSaveWork')) && !(await page.$('#fxPush')) && !(await page.$('#fxCommit')));
    await env.shot('next-codefix-workspace-applied.png');

    T.section('Save in working: committed there, never pushed');
    await page.click('#fxSaveWork');
    await page.waitForSelector('#fxCommitted', { timeout: 20000 }).catch(() => {});
    T.check('saved: a commit on buildrite-working, on this PC only; what is next said', /Saved in working: commit [0-9a-f]+ on buildrite-working \(on this PC\)/.test(await text(page, '#fxResult'))
      && /Saved in working: commit [0-9a-f]+ on buildrite-working, on this PC only/.test(await text(page, '#fxCommitted')) && /To send it to VB Studio: Apply to main, then Push/.test(await text(page, '#fxCommitted')), await text(page, '#fxCommitted'));
    T.check('…in the working folder\'s branch; origin unchanged, no buildrite-working there', git(working, 'log', '-1', '--format=%s').indexOf('Code fix: My Billing') === 0
      && pg.gitRemote('rev-parse', 'pages/test') === remoteHead && pg.gitRemote('branch', '--list', 'buildrite-working') === '');
    T.check('…a way to its project\'s tab (Apply to main → Push)', /Open its project \(Apply to main → Push\)/.test(await text(page, '#fxOpenProject')));
    await env.shot('next-codefix-workspace-saved.png');
    T.check('no page errors', errs().length === 0, errs().join(' | '));
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await env.close();
    try { git(pg.root, 'worktree', 'remove', '--force', working); } catch (e) { /* tmp */ }
    pg.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  T.report();
})();
