/*
 * Code fix in your workspace, in a browser: Application pages and Code fix read a VB Studio workspace's working folder
 * (a worktree on buildrite-working, as the set-up wizard makes it), and a change goes there only — the panel says
 * whose folder it is (no other to pick), approving writes the files there (nothing pulled), "Save in working" commits
 * there (no Commit & push: nothing reaches VB Studio but by Apply to main → Push, in the project's tab), and the
 * project's own checkout and its origin are left as they were. Then Page code marks what changed against VB Studio:
 * the lines added, the change note, the file in the list; Next change goes through them. And Capture screenshot and
 * Run it open the page from the workspace's own build (a stand-in here for the desktop app's): said so, and where a page
 * sent the capture when it did not show itself.
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
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const opened = [];

(async () => {
  const pg = await E.pagesSandbox({});
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-fix-ws-e2e-'));
  // the workspace's working folder: a worktree of the checkout (its main folder), on buildrite-working
  const working = path.join(dir, 'BuildRite', 'rebuild-app-dev-one', 'working');
  git(pg.root, 'worktree', 'add', '-q', '-B', 'buildrite-working', working);
  const ws = { folder: working, label: 'Rebuild App ▸ Dev_One', branch: 'buildrite-working', key: 'acme-dev1/rebuild-app_100010', name: 'Rebuild App', ws: 'Dev_One' };
  const pagesStore = require('../../desktop/lib/pages').open({ root: pg.root, rootFn: () => working, rootLabel: () => 'Rebuild App ▸ Dev_One (dev-one)', spaceFn: () => 'acme-dev1_rebuild-app_100010',
    baseFn: () => ({ ref: 'origin/pages/test', label: 'VB Studio (pages/test)' }), // what VB Studio has: the branch on origin
    // the desktop app's: the page opened in the working folder's build (lib/workPreview.js) — a stand-in
    capture: async (app, url) => { opened.push('capture ' + app + ' ' + url); return { ok: true, base64: PNG, mime: 'image/png', from: 'workspace', built: true, landed: '/vp/shell/main/main-equiprite' }; },
    run: async (app, url) => { opened.push('run ' + app + ' ' + url); return { ok: true, url: 'http://127.0.0.1:4100' + url, from: 'workspace', built: false }; } });
  const lines = fs.readFileSync(path.join(working, BILL + '.html'), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const mainHtml = fs.readFileSync(path.join(pg.root, BILL + '.html'), 'utf8');
  const remoteHead = pg.gitRemote('rev-parse', 'pages/test');
  const fixStore = require('../../desktop/lib/codeFix').open({ root: pg.root, file: path.join(dir, 'code-fixes.json'), workFn: () => ws, pickFolder: async () => pg.root, ai: {
    settings: () => ({ active: 'x', catalog: [{ id: 'x', label: 'Stand-in AI' }] }),
    chat: async () => ({ ok: true, provider: 'Stand-in AI', model: 'test', text: ['## Summary', 'A note in the header comment.', '## How it works today', 'It lists billed requests.', '## What changes', 'One comment line.',
      '## The change', '- `' + BILL + '.html` — a comment line', '## After the change', 'The same.', '## Risks', 'None known', '## How to test', '1. Open My Billing.', '## Questions', 'None', '',
      'FILE: ' + BILL + '.html', '<<<<<<< SEARCH', lines.slice(1, 3).join('\n'), '=======', lines.slice(1, 3).join('\n') + '\n  Overdue invoices first (workspace fix).', '>>>>>>> REPLACE'].join('\n') }) } });
  // ▶ Run beside the working folder: the desktop app builds it and opens its app in a window of its own — a stand-in
  const runs = [];
  const vbsStore = { work: () => ({ copies: [], current: null }), state: () => ({}) };
  const vbsRun = async (b) => { runs.push(b); await new Promise((r) => setTimeout(r, 400)); return { ok: true, url: 'http://127.0.0.1:4100/', app: 'vbredwoodapp', built: false, ms: 300, branch: 'buildrite-working', base: 'VB Studio (pages/test)',
    changed: ['webApps/vbredwoodapp/flows/customer-portal/pages/customer-my-billing-page.html'] }; };
  const env = await E.start({ port: 19845, app: 'next', pagesStore, fixStore, vbsStore, vbsRun });
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
    T.check('▶ Run beside the working folder (its app, in a window of its own)', /^▶\s*Run$/.test(await text(page, '#pgRunWs')) && /working folder's app in a window of its own/.test((await page.getAttribute('#pgRunWs', 'title')) || ''), await text(page, '#pgRunWs'));
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

    T.section('Page code: what changed, marked (against VB Studio)');
    await page.click('#pgTabCode');
    await page.waitForSelector('#pgCodeChanges', { timeout: 15000 }).catch(() => {});
    T.check('the file: its changes since VB Studio counted; Previous / Next change; the colours (a Build.Rite note too)', /^\d+ changes? since VB Studio \(pages\/test\): \+\d+ −0 lines?$/.test(await text(page, '#pgCodeChg'))
      && !!(await page.$('#pgCodeNext')) && /added\s*changed\s*taken away\s*Build\.Rite note/.test(await text(page, '#pgCodeChanges')), await text(page, '#pgCodeChanges'));
    T.check('…the file marked in the list (+n −0), the others not', /^\+\d+ −0$/.test(await text(page, '#pgCodeFiles .nx-cv-file--on .nx-cv-fchg')) && (await page.$$('#pgCodeFiles .nx-cv-file--changed')).length === 1, await text(page, '#pgCodeFiles .nx-cv-file--on'));
    const marked = await page.evaluate(() => { const d = document.getElementById('pgCodeFrame').contentDocument; const q = (s) => Array.from(d.querySelectorAll(s)).map((e) => e.textContent); return { add: q('.l.ca').length, note: q('.l.bn').join('\n'), fix: q('.l.ca').filter((t) => /Overdue invoices first \(workspace fix\)/.test(t)).length, cur: q('.l.cur').length }; });
    T.check('…in the code: the lines added marked (the fix\'s line among them), the change note tinted, the first change outlined', marked.add >= 9 && marked.fix === 1 && /Build\.Rite change fx[a-z0-9]+ — My Billing/.test(marked.note) && /Jira story: +EQP-123/.test(marked.note) && /end of Build\.Rite change/.test(marked.note) && marked.cur > 0, JSON.stringify(marked).slice(0, 300));
    const nChanges = Number(((await text(page, '#pgCodeChg')).match(/^(\d+)/) || [])[1] || 0);
    await page.click('#pgCodeNext');
    await page.waitForTimeout(300);
    T.check('Next change: the next one (Change 2 of n)', nChanges < 2 || (await text(page, '#pgCodeAt')) === 'Change 2 of ' + nChanges, await text(page, '#pgCodeAt'));
    await env.shot('next-codefix-workspace-pagecode.png');

    T.section('Capture and Run it: from your workspace\'s working folder');
    await page.click('#pgTabPage');
    await page.waitForSelector('#pgRun', { timeout: 10000 }).catch(() => {});
    T.check('Run it offered beside Capture (your workspace: its working folder, running)', !!(await page.$('#pgRun')) && /your workspace's working folder/.test((await page.getAttribute('#pgRun', 'title')) || ''));
    await page.click('#pgCapture');
    await page.waitForFunction(() => /Screenshot captured/.test((document.getElementById('pgResult') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
    T.check('Capture: of your working folder\'s code (built just now, with your changes); the page sent it elsewhere — said', opened[0] === 'capture vbredwoodapp /vp/shell/customer-portal/customer-my-billing'
      && /From your workspace's working folder \(built just now, with your changes\)/.test(await text(page, '#pgResult')) && /it sent you to \/vp\/shell\/main\/main-equiprite/.test(await text(page, '#pgResult')), await text(page, '#pgResult'));
    T.check('…its thumbnail says so too', /from your workspace's working folder · the page sent it to \/vp\/shell\/main\/main-equiprite/.test((await page.getAttribute('#pgShots .nx-pg-shotbtn', 'title')) || ''), (await page.getAttribute('#pgShots .nx-pg-shotbtn', 'title')) || '');
    await page.click('#pgRunWs');
    await page.waitForFunction(() => /is running in its own window/.test((document.querySelector('.nx-toast') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    T.check('▶ Run (the working folder): the app running — your working copy, your change since VB Studio named; said under it too', runs.length === 1
      && /▶ vbredwoodapp is running in its own window — your working copy \(buildrite-working\), no change since its last build\. Your 1 change since VB Studio \(pages\/test\) are in it: customer-my-billing-page\.html\./.test(await text(page, '.nx-toast'))
      && /customer-my-billing-page\.html/.test(await text(page, '#pgResult')), await text(page, '.nx-toast'));
    await page.click('#pgRun');
    await page.waitForFunction(() => /Opened in a window/.test((document.getElementById('pgResult') || {}).textContent || ''), null, { timeout: 20000 }).catch(() => {});
    T.check('Run it: opened in a window, from your workspace\'s working folder', opened[1] === 'run vbredwoodapp /vp/shell/customer-portal/customer-my-billing'
      && /Opened in a window: http:\/\/127\.0\.0\.1:4100\/vp\/shell\/customer-portal\/customer-my-billing — your workspace's working folder\./.test(await text(page, '#pgResult')), await text(page, '#pgResult'));
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
