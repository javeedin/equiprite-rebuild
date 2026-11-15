/*
 * Build.Rite's Run console, in a browser: what happens when your workspace runs, as it happens, and commands typed like an
 * editor's terminal — against the real console engine (desktop/lib/runConsole.js) with stand-ins for what only the desktop
 * app does (build, open a window, git):
 *   - the top bar's >_ (beside ▶ Run) opens it; who the app runs as is said (not signed in: anonymous, Sign in as…)
 *   - the log shows the build, the requests, the app's own console, as they come; the filters; Clear
 *   - a command typed (Enter), a button (▶ Run, Reload…), ↑ for the last one; help; git push refused
 *   - the app landing on "You don't have access": said (a banner); Run as — a user and a role chosen, applied
 *
 * Run:  node tests/e2e/next-run-console.e2e.js   (after npm run build)
 */
'use strict';
const E = require('./harness');
const H = require('../_harness');
const RC = require('../../desktop/lib/runConsole');
const DS = require('../../desktop/lib/devserver');

const T = H.makeAsserter();
const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');

(async () => {
  // a workspace in use (the top bar shows it, with ▶ Run and >_)
  const current = { id: 'w1', projectName: 'Rebuild App', workspace: 'Dev_One', branch: 'dev-one', repo: 'rebuild-app', working: '/tmp/BuildRite/rebuild-app-dev-one/working', main: '/tmp/BuildRite/rebuild-app-dev-one/main', exists: true, summary: {} };
  const vbsStore = { work: () => ({ ok: true, copies: [current], current: current }), state: () => ({}) };
  // the console engine, its doings stood in for
  const con = RC.open();
  let signedInAs = '';
  let runAs = { user: '', roles: [] }, noAccess = null;
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
      if (!runAs.user) { con.push('nav', '→ /vp/shell/main/no-access'); noAccess = { at: '2026-11-15T09:00:00Z', url: '/vp/shell/main/no-access', as: 'anonymous' }; }
      return { ok: true, text: '▶ vbredwoodapp running in its window at http://127.0.0.1:4100/' };
    },
    reload: async () => { did.push('reload'); return { ok: true, text: 'reloaded' }; },
    git: async (sub) => { did.push('git ' + sub); return { ok: true, lines: ['## buildrite-working', ' M webApps/vbredwoodapp/resources/js/dashboardRoleConfig.js'] }; },
    signin: async () => { did.push('signin'); signedInAs = 'priya.raman'; return { ok: true, text: 'The sign-in window is open.' }; },
    runAs: async (user, roles) => {
      if (user == null) return { ok: true, text: 'the app runs as ' + (runAs.user || 'anonymous') };
      if (user && !roles.length) return { ok: false, text: 'Give ' + user + ' at least one role' };
      did.push('as ' + user + ' ' + roles.join(','));
      runAs = { user: user, roles: user ? roles : [] }; noAccess = null;
      return { ok: true, text: 'the app runs as ' + (user ? user + ' (' + roles.join(', ') + ')' : 'the sign-in') + ' — its window reloaded' };
    },
  };
  const statusOf = () => ({ ok: true, signedInAs: runAs.user || signedInAs, roles: runAs.user ? runAs.roles : null, by: runAs.user ? 'run-as' : (signedInAs ? 'sign-in' : ''), runAs: runAs, knownRoles: DS.KNOWN_ROLES, noAccess: noAccess,
    workspace: 'Rebuild App ▸ Dev_One', working: current.working, branch: 'dev-one', built: did.length > 0, builtAt: '2026-11-15T09:00:00Z', building: false, window: did.length ? 'http://127.0.0.1:4100/' : '' });
  const vbsConsole = { lines: (a) => con.lines(a), command: (t) => con.command(t, does), clear: () => con.clear(), status: statusOf,
    progress: () => ({ ok: true, running: false, title: '▶ Run', at: '2026-11-15T09:00:00.000Z', end: '2026-11-15T09:00:04.200Z', text: 'built in 3.4 s', tail: ['Running "vb-process-local" task', 'Done.'],
    steps: [{ key: 'check', label: 'Check for changes', state: 'done', text: 'it changed since its last build: building it again' }, { key: 'copy', label: 'Copy the working folder', state: 'done', text: 'copied in 0.5 s' },
      { key: 'prepare', label: 'Prepare the copy', state: 'done', text: 'the Component Exchange list of vbredwoodapp emptied in the copy' }, { key: 'build', label: 'Build — Oracle\'s VB build tool', state: 'done', text: 'built in 3.4 s' },
      { key: 'serve', label: 'Start the app\'s server', state: 'done', text: 'started at http://127.0.0.1:4100' }, { key: 'open', label: 'Open the app\'s window', state: 'done', text: 'opened http://127.0.0.1:4100/' }] }),
    runAs: async (b) => { const r = await does.runAs(b.user, b.roles); con.push(r.ok ? 'info' : 'error', r.text); return Object.assign(statusOf(), { ok: r.ok, text: r.text }); } };
  con.push('info', 'Build.Rite started');
  const vbsRun = async () => { await new Promise((r) => setTimeout(r, 600)); return { ok: true, url: 'http://127.0.0.1:4100/', app: 'vbredwoodapp', built: true, ms: 4200, branch: 'buildrite-working', base: 'VB Studio (dev-one)', changed: [], signedInAs: 'priya.raman', roles: ['RT_EQP_ADMINISTRATOR'] }; };
  const env = await E.start({ port: 19855, app: 'next', product: 'buildrite', vbsStore, vbsConsole, vbsRun });
  const page = env.page;
  const errs = () => env.errors.filter((e) => !/404|401|Failed to load resource/.test(e) && !e.startsWith('warning'));
  const logText = () => text(page, '#rcLog');
  try {
    T.section('opened from the top bar');
    await env.open('/');
    await page.waitForSelector('#nxWorkConsole', { timeout: 20000 }).catch(() => {});
    T.check('>_ beside ▶ Run in the top bar', !!(await page.$('#nxWorkConsole')) && !!(await page.$('#nxWorkRun')) && /Run console/.test((await page.getAttribute('#nxWorkConsole', 'title')) || ''));
    await page.click('#nxWorkRun');
    await page.waitForFunction(() => /Open the app's window/.test((document.getElementById('nxRunProg') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('▶ Run (the top bar): what it is doing, step by step, drops down under it (Oracle\'s VB build tool among them)', (await page.$$('#nxRunProg .rp-s')).length === 6 && /Build — Oracle's VB build tool/.test(await text(page, '#nxRunProg')), await text(page, '#nxRunProg'));
    await page.waitForFunction(() => /is running in its own window/.test((document.querySelector('.nx-toast') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => !document.getElementById('nxRunProg'), null, { timeout: 9000 }).catch(() => {});
    T.check('…gone a few seconds after it ran', !(await page.$('#nxRunProg')));
    await page.click('#nxWorkConsole');
    await page.waitForSelector('#rcLog:visible', { timeout: 15000 }).catch(() => {});
    T.check('…it opens the Run console (a tab)', /Run console/.test(await text(page, '.nx-tab--on')) && (await page.isVisible('#rcLog')), await text(page, '.nx-tab--on'));
    await page.waitForFunction(() => /Build\.Rite started/.test((document.getElementById('rcLog') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('the log: what happened so far', /Build\.Rite started/.test(await logText()));
    await page.waitForFunction(() => /anonymous/.test((document.getElementById('rcWho') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('who the app runs as: anonymous, pages that need access hidden; Sign in as… and Run as offered', /The app runs anonymous — pages that need access stay hidden/.test(await text(page, '#rcWho')) && !!(await page.$('#rcSignin')) && !!(await page.$('#rcAsUser'))
      && (await page.$$('#rcAsRoles .nx-chip')).length === 8 && /Administrator/.test(await text(page, '#rcAsRoles'))
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

    T.section('"You don\'t have access" — Run as');
    await page.waitForSelector('#rcNoAccess', { timeout: 8000 }).catch(() => {});
    T.check('the app landed on its no-access page: said in a banner (as whom), what to do', /The app said "You don't have access" — it ran as anonymous\. Choose a user and a role below, then Apply/.test(await text(page, '#rcNoAccess')), await text(page, '#rcNoAccess'));
    await page.fill('#rcAsUser', 'priya.raman');
    await page.click('#rcAsApply');
    await page.waitForFunction(() => /at least one role/.test((document.querySelector('.nx-toast') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('…a user with no role: refused, said (the app would show nothing)', /Give priya\.raman at least one role/.test(await text(page, '.nx-toast')) && did.filter((d) => /^as /.test(d)).length === 0, await text(page, '.nx-toast'));
    await page.click('#rcAsRoles [data-key="RT_EQP_ADMINISTRATOR"]');
    T.check('…a role chosen: its chip on', /nx-chip--on/.test((await page.getAttribute('#rcAsRoles [data-key="RT_EQP_ADMINISTRATOR"]', 'class')) || ''));
    await page.click('#rcAsApply');
    await page.waitForFunction(() => /runs as priya\.raman/.test((document.getElementById('rcWho') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('…Apply: the app runs as priya.raman, Administrator (Run as); the banner gone; said', did.indexOf('as priya.raman RT_EQP_ADMINISTRATOR') !== -1 && /The app runs as priya\.raman · Administrator \(Run as\)/.test(await text(page, '#rcWho'))
      && !(await page.$('#rcNoAccess')) && /its window reloaded/.test(await text(page, '.nx-toast')) && !!(await page.$('#rcAsClear')), await text(page, '#rcWho'));
    await page.fill('#rcCmd', 'as');
    await page.press('#rcCmd', 'Enter');
    // (its answer after the typed line — the same words are in the log already, from Apply)
    await page.waitForFunction(() => /> as\s*\d\d:\d\d:\d\d\s*info\s*the app runs as priya\.raman/.test((document.getElementById('rcLog') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('…as (typed): who it runs as now', /> as\s*\d\d:\d\d:\d\d\s*info\s*the app runs as priya\.raman/.test(await logText()), (await logText()).slice(-300));
    await page.click('#rcAsClear');
    await page.waitForFunction(() => /anonymous|sign-in/.test((document.getElementById('rcWho') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('…Use the EquipRite sign-in: Run as cleared (anonymous again here)', /anonymous/.test(await text(page, '#rcWho')) && (await page.inputValue('#rcAsUser')) === '', await text(page, '#rcWho'));

    T.section('filters, sign in, clear');
    await page.click('#rcFilters [data-key="errors"]');
    const shown = await page.$$eval('#rcLog .rc-l', (ls) => ls.filter((l) => getComputedStyle(l).display !== 'none').map((l) => l.className.replace('rc-l rc-k-', '')));
    T.check('Errors: only the errors, warnings (and what you typed)', shown.length > 0 && shown.every((k) => k === 'error' || k === 'warn' || k === 'cmd') && shown.indexOf('error') !== -1, shown.join(','));
    await page.click('#rcFilters [data-key=""]');
    await page.click('#rcSignin');
    await page.waitForFunction(() => /runs as priya\.raman/.test((document.getElementById('rcWho') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    T.check('Sign in as…: the sign-in opened; then who the app runs as (the EquipRite sign-in)', did.indexOf('signin') !== -1 && /The app runs as priya\.raman · roles from Fusion \(the EquipRite sign-in\)/.test(await text(page, '#rcWho')) && !(await page.$('#rcSignin')), await text(page, '#rcWho'));
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
