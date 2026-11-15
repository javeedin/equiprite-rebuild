/*
 * Build.Rite's Run console, in a browser: what happens when your workspace runs, as it happens, and commands typed like an
 * editor's terminal — against the real console engine (desktop/lib/runConsole.js) with stand-ins for what only the desktop
 * app does (build, open a window, git):
 *   - the top bar's >_ (beside ▶ Run) opens it; who the app runs as is said (not signed in: anonymous, Sign in as…)
 *   - the log shows the build, the requests, the app's own console, as they come; the filters; Clear
 *   - a command typed (Enter), a button (▶ Run, Reload…), ↑ for the last one; help; git push refused
 *
 * Run:  node tests/e2e/next-run-console.e2e.js   (after npm run build)
 */
'use strict';
const E = require('./harness');
const H = require('../_harness');
const RC = require('../../desktop/lib/runConsole');

const T = H.makeAsserter();
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');

(async () => {
  // a workspace in use (the top bar shows it, with ▶ Run and >_)
  const current = { id: 'w1', projectName: 'Rebuild App', workspace: 'Dev_One', branch: 'dev-one', repo: 'rebuild-app', working: '/tmp/BuildRite/rebuild-app-dev-one/working', main: '/tmp/BuildRite/rebuild-app-dev-one/main', exists: true, summary: {} };
  const vbsStore = { work: () => ({ ok: true, copies: [current], current: current }), state: () => ({}) };
  // the console engine, its doings stood in for
  const con = RC.open();
  let signedInAs = '';
  const did = [];
  const does = {
    run: async (route) => {
      did.push('run ' + route);
      con.push('info', '▶ Run: vbredwoodapp of Rebuild App ▸ Dev_One — building its working copy when its code changed…');
      con.push('build', 'Running "vb-process-local" task');
      con.push('build', 'Done.');
      con.push('nav', 'opened http://127.0.0.1:4100' + (route || '/'));
      con.push('server', 'eqpt GET /eqp/v1/views/workbench-requests -> 200 (88 ms)');
      con.push('app', '[dashboardInitChain] 3 tiles for REQUESTOR   (dashboardInitChain.js:640)');
      con.push('warn', 'eqpt GET /eqp/v1/rbac/page-access -> 401 (12 ms)');
      con.push('error', 'Uncaught TypeError: x is undefined   (main-equiprite-page.js:12)');
      return { ok: true, text: '▶ vbredwoodapp running in its window at http://127.0.0.1:4100/' };
    },
    reload: async () => { did.push('reload'); return { ok: true, text: 'reloaded' }; },
    git: async (sub) => { did.push('git ' + sub); return { ok: true, lines: ['## buildrite-working', ' M webApps/vbredwoodapp/resources/js/dashboardRoleConfig.js'] }; },
    signin: async () => { did.push('signin'); signedInAs = 'priya.raman'; return { ok: true, text: 'The sign-in window is open.' }; },
  };
  const vbsConsole = { lines: (a) => con.lines(a), command: (t) => con.command(t, does), clear: () => con.clear(),
    status: () => ({ ok: true, signedInAs: signedInAs, workspace: 'Rebuild App ▸ Dev_One', working: current.working, branch: 'dev-one', built: did.length > 0, builtAt: '2026-11-15T09:00:00Z', building: false, window: did.length ? 'http://127.0.0.1:4100/' : '' }) };
  con.push('info', 'Build.Rite started');
  const env = await E.start({ port: 19855, app: 'next', product: 'buildrite', vbsStore, vbsConsole });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const logText = () => text(page, '#rcLog');
  try {
    T.section('opened from the top bar');
    await env.open('/');
    await page.waitForSelector('#nxWorkConsole', { timeout: 20000 }).catch(() => {});
    T.check('>_ beside ▶ Run in the top bar', !!(await page.$('#nxWorkConsole')) && !!(await page.$('#nxWorkRun')) && /Run console/.test((await page.getAttribute('#nxWorkConsole', 'title')) || ''));
    await page.click('#nxWorkConsole');
    await page.waitForSelector('#rcLog:visible', { timeout: 15000 }).catch(() => {});
    T.check('…it opens the Run console (a tab)', /Run console/.test(await text(page, '.nx-tab--on')) && (await page.isVisible('#rcLog')), await text(page, '.nx-tab--on'));
    await page.waitForFunction(() => /Build\.Rite started/.test((document.getElementById('rcLog') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('the log: what happened so far', /Build\.Rite started/.test(await logText()));
    await page.waitForFunction(() => /anonymous/.test((document.getElementById('rcWho') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('who the app runs as: not signed in — anonymous, pages that need access hidden; Sign in as… offered', /Not signed in to EquipRite: the app runs anonymous/.test(await text(page, '#rcWho')) && !!(await page.$('#rcSignin'))
      && /Workspace Rebuild App ▸ Dev_One/.test(await text(page, '#rcHead')), await text(page, '#rcHead'));

    T.section('commands: typed, and the buttons');
    await page.fill('#rcCmd', 'help');
    await page.press('#rcCmd', 'Enter');
    await page.waitForFunction(() => /run <page>/.test((document.getElementById('rcLog') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('help (typed, Enter): the commands, what was typed shown; the line emptied', /> help/.test(await logText()) && /run <page>\s+straight on a page/.test(await logText()) && (await page.inputValue('#rcCmd')) === '');
    await page.click('#rcRun');
    await page.waitForFunction(() => /Uncaught TypeError/.test((document.getElementById('rcLog') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    const kinds = await page.$$eval('#rcLog .rc-l', (ls) => ls.map((l) => l.className.replace('rc-l rc-k-', '')));
    T.check('▶ Run: the build\'s output, where the window went, its requests, the app\'s own console, a 401 (amber), an error (red) — as they came', did[0] === 'run ' && ['build', 'nav', 'server', 'app', 'warn', 'error'].every((k) => kinds.indexOf(k) !== -1)
      && /vb-process-local/.test(await logText()) && /-> 401/.test(await text(page, '#rcLog .rc-k-warn')) && /Uncaught TypeError/.test(await text(page, '#rcLog .rc-k-error')), kinds.join(','));
    await page.waitForFunction(() => /Window open/.test((document.getElementById('rcWin') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('…the head: built, the window open', /Built /.test(await text(page, '#rcBuild')) && /Window open: \//.test(await text(page, '#rcWin')), await text(page, '#rcHead'));
    await page.fill('#rcCmd', 'run equipment-foundation/equipment-create');
    await page.press('#rcCmd', 'Enter');
    await page.waitForFunction(() => /opened http:\/\/127\.0\.0\.1:4100\/vp\/shell\/equipment-foundation\/equipment-create/.test((document.getElementById('rcLog') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('run <page>: straight on that page', did[1] === 'run /vp/shell/equipment-foundation/equipment-create');
    await page.press('#rcCmd', 'ArrowUp');
    T.check('↑: the last command again', (await page.inputValue('#rcCmd')) === 'run equipment-foundation/equipment-create');
    await page.fill('#rcCmd', 'git push --force');
    await page.press('#rcCmd', 'Enter');
    await page.waitForFunction(() => /only git status, git log, git diff and git branch/.test((document.getElementById('rcLog') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('git push: refused (read only), nothing run', /only git status, git log, git diff and git branch here \(read only\)/.test(await text(page, '#rcLog .rc-k-error:last-child')) && !did.some((d) => /push/.test(d)));
    await page.fill('#rcCmd', 'git status');
    await page.press('#rcCmd', 'Enter');
    await page.waitForFunction(() => /dashboardRoleConfig\.js/.test((document.getElementById('rcLog') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('git status: its lines', did.indexOf('git status') !== -1 && /M webApps\/vbredwoodapp\/resources\/js\/dashboardRoleConfig\.js/.test(await logText()));
    await page.click('#rcReload');
    await page.waitForFunction(() => /reloaded/.test((document.getElementById('rcLog') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('Reload (a button): done', did.indexOf('reload') !== -1);

    T.section('filters, sign in, clear');
    await page.click('#rcFilters [data-key="errors"]');
    const shown = await page.$$eval('#rcLog .rc-l', (ls) => ls.filter((l) => getComputedStyle(l).display !== 'none').map((l) => l.className.replace('rc-l rc-k-', '')));
    T.check('Errors: only the errors, warnings (and what you typed)', shown.length > 0 && shown.every((k) => k === 'error' || k === 'warn' || k === 'cmd') && shown.indexOf('error') !== -1, shown.join(','));
    await page.click('#rcFilters [data-key=""]');
    await page.click('#rcSignin');
    await page.waitForFunction(() => /runs as priya\.raman/.test((document.getElementById('rcWho') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('Sign in as…: the sign-in opened; then who the app runs as', did.indexOf('signin') !== -1 && /The app runs as priya\.raman/.test(await text(page, '#rcWho')) && !(await page.$('#rcSignin')), await text(page, '#rcWho'));
    await env.shot('buildrite-run-console.png');
    await page.click('#rcClear');
    await page.waitForTimeout(1200);
    T.check('Clear: the log empty (and stays so)', (await page.$$('#rcLog .rc-l')).length === 0);
    T.check('no page errors', errs().length === 0, errs().join(' | '));
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    await env.close();
  }
  T.report();
})();
