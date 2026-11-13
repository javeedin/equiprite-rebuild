#!/usr/bin/env node
'use strict';
/**
 * Sandboxes (desktop/lib/codeFix.js makeSandbox …): a proposed fix tried first in a copy of the code, before anyone
 * approves it — with real git (a project whose origin is a bare repository), a real page, Oracle's real build tool
 * (this project's node_modules) and the real local server:
 *   made (a git worktree on fix/<KEY> in the data folder's sandboxes/, from origin at a known commit; the fix written
 *   there, the person's checkout untouched; built in its own build/ folder; each step said) → what it changed (git) and
 *   its diff → run (its own local server: the changed page served from the sandbox) → behind its base when origin moves
 *   → its tests → a sandbox that is not the approved change is refused → promoted (committed and pushed from it; the
 *   folder kept) → thrown away (servers stopped, folder gone; the branch kept or deleted) → made again on changed code:
 *   out of date, nothing left behind. Never outside its sandboxes folder.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const CF = require('../desktop/lib/codeFix');
const { createDevServer } = require('../desktop/lib/devserver');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const PAGE = 'webApps/vbredwoodapp/flows/customer-portal/pages/customer-my-billing-page';
const ID = 'vbredwoodapp/customer-portal/customer-my-billing';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const copyDir = (from, to) => { fs.mkdirSync(to, { recursive: true }); fs.readdirSync(from).forEach((f) => { const a = path.join(from, f), b = path.join(to, f); if (fs.statSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b); }); };
const get = (url) => new Promise((resolve) => { http.get(url, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b })); }).on('error', (e) => resolve({ status: 0, body: String(e.message) })); });

(async () => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (e) { T.check('git is installed (skipping)', true); T.report(); return; }
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'grunt', 'bin', 'grunt'))) { T.check('the build tool is installed (npm install; skipping)', true); T.report(); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-sandbox-'));
  const remote = path.join(tmp, 'origin.git'), A = path.join(tmp, 'project'), B = path.join(tmp, 'teammate');
  const servers = [];
  try {
    git(tmp, 'init', '-q', '--bare', '-b', 'main', remote);
    fs.mkdirSync(A); git(A, 'init', '-q', '-b', 'main'); git(A, 'config', 'user.name', 'Tester'); git(A, 'config', 'user.email', 't@example.com');
    copyDir(path.join(ROOT, 'webApps', 'vbredwoodapp'), path.join(A, 'webApps', 'vbredwoodapp'));
    fs.copyFileSync(path.join(ROOT, 'visual-application.json'), path.join(A, 'visual-application.json'));
    fs.writeFileSync(path.join(A, '.gitignore'), 'build/\n');
    git(A, 'add', '-A'); git(A, 'commit', '-q', '-m', 'project'); git(A, 'remote', 'add', 'origin', remote); git(A, 'push', '-q', '-u', 'origin', 'main');
    const head0 = git(A, 'rev-parse', 'HEAD');
    const html0 = fs.readFileSync(path.join(A, PAGE + '.html'), 'utf8');
    const anchor = html0.replace(/\r\n/g, '\n').split('\n').slice(1, 3).join('\n');
    const answer = ['## Summary', 'Mark the list.', '## How it works today', 'x', '## What is wrong', 'x', '## The change', '- the page', '## After the change', 'x', '## Risks', 'None known', '## How to test', '1. Open it.', '## Questions', 'None', '',
      'FILE: ' + PAGE + '.html', '<<<<<<< SEARCH', anchor, '=======', anchor + '\n  <!-- EQP-1: tried in the sandbox -->', '>>>>>>> REPLACE'].join('\n');
    const ai = { settings: () => ({ active: 'x', catalog: [{ id: 'x', label: 'Stand-in AI' }] }), chat: async () => ({ ok: true, provider: 'Stand-in AI', text: answer }) };
    const mainBuilt = path.join(ROOT, 'build', 'processed', 'webApps', 'vbredwoodapp', 'index.html');
    const mainMtime = fs.existsSync(mainBuilt) ? fs.statSync(mainBuilt).mtimeMs : 0;
    const store = CF.open({ root: A, file: path.join(tmp, 'data', 'code-fixes.json'), ai: ai, buildTool: ROOT,
      serveSandbox: async (s) => { const srv = await createDevServer({ buildDir: s.buildDir, repoRoot: s.dir, webApp: s.webApp, port: 0, getIdentity: () => ({ username: 'tester' }) }); servers.push(srv); return srv; },
      appUrl: () => 'http://localhost:9/' });

    T.section('made: a copy of the code, the fix written there, built — each step said');
    const an = await store.analyze({ id: ID, request: 'Mark the billing list', kind: 'fix', by: 'Asha' });
    T.check('a proposal to try', an.ok && an.fix.files.length === 1, an.error);
    const steps = [];
    const made = await store.makeSandbox({ fix: an.fix.id, branch: 'fix/EQP-1', by: 'Asha', onStep: (s) => steps.push(s) });
    const sbx = made.sandbox || {};
    const sbRoot = path.join(tmp, 'data', 'code-fixes', 'sandboxes');
    T.check('made: its own folder (the data folder\'s sandboxes/fix-EQP-1), on fix/EQP-1 from origin/main at the commit it started from', made.ok && path.resolve(sbx.dir) === path.join(sbRoot, 'fix-EQP-1') && sbx.branch === 'fix/EQP-1'
      && sbx.start === 'origin/main' && sbx.baseCommit === head0 && sbx.fetched && sbx.pc === os.hostname() && git(A, 'worktree', 'list').indexOf(path.join(sbRoot, 'fix-EQP-1')) !== -1, JSON.stringify(made).slice(0, 400));
    T.check('…the fix written in the sandbox; your own checkout untouched (file, branch, commit)', /EQP-1: tried in the sandbox/.test(fs.readFileSync(path.join(sbx.dir, PAGE + '.html'), 'utf8'))
      && fs.readFileSync(path.join(A, PAGE + '.html'), 'utf8') === html0 && git(A, 'rev-parse', '--abbrev-ref', 'HEAD') === 'main' && git(A, 'rev-parse', 'HEAD') === head0 && git(A, 'status', '--porcelain') === '');
    T.check('…built with this project\'s build tool, in the sandbox\'s own build folder (the project\'s own build untouched)', sbx.built && sbx.built.ok && fs.existsSync(path.join(sbx.dir, 'build', 'processed', 'webApps', 'vbredwoodapp', 'index.html'))
      && (!mainMtime || fs.statSync(mainBuilt).mtimeMs === mainMtime), JSON.stringify(sbx.built));
    const st = (k) => steps.filter((s) => s.key === k && s.state !== 'running' && s.state !== 'log').map((s) => s.state).pop();
    T.check('…each step said: latest code, the copy, the fix fits, tests before (none name it), written, built, ready', st('fetch') === 'done' && st('copy') === 'done' && st('check') === 'done' && st('before') === 'skipped'
      && st('write') === 'done' && st('build') === 'done' && st('end') === 'done' && /your own code folder is not touched/.test(steps.filter((s) => s.key === 'write' && s.state === 'done')[0].detail), JSON.stringify(steps.map((s) => s.key + ':' + s.state)));
    T.check('…the fix\'s history says so', store.get(an.fix.id).fix.events.some((e) => e.what === 'sandbox made' && /fix\/EQP-1 from origin\/main @ /.test(e.detail)));

    T.section('what it changed, and its diff');
    let s1 = await store.sandboxStatus(sbx, { diff: true });
    T.check('there, on this PC: the one file it changed (as made), not behind, built; its diff with the added line', s1.exists && s1.here && s1.changed.length === 1 && s1.changed[0].file === PAGE + '.html' && s1.asMade && s1.behind === 0 && s1.built && !s1.committed
      && /^\+\s*<!-- EQP-1: tried in the sandbox -->/m.test(s1.diff) && /^diff --git a\/webApps\/vbredwoodapp/m.test(s1.diff), JSON.stringify(Object.assign({}, s1, { diff: (s1.diff || '').slice(0, 200) })));
    T.check('on another PC: not there', !(await store.sandboxStatus(Object.assign({}, sbx, { pc: 'SOMEONE-ELSE' }))).exists);

    T.section('run: its own local server, the changed page served from the sandbox');
    const run = await store.sandboxRun(sbx);
    const ver = fs.readdirSync(path.join(sbx.dir, 'build', 'processed', 'webApps', 'vbredwoodapp')).filter((n) => /^version_/.test(n))[0];
    const served = run.ok ? await get(run.base + '/' + ver + '/flows/customer-portal/pages/customer-my-billing-page.html') : { status: 0 };
    const index = run.ok ? await get(run.base + '/') : { status: 0 };
    T.check('its address: a port of its own, on the issue\'s page (or the screen it is opened from); the app as it is now beside it', run.ok && /^http:\/\/localhost:\d+$/.test(run.base) && run.url.indexOf(run.base) === 0
      && (run.route ? run.current === 'http://localhost:9' + run.route : !!run.needs), JSON.stringify(run));
    T.check('…the sandbox\'s app is served: the page with the fix in it', index.status === 200 && served.status === 200 && /EQP-1: tried in the sandbox/.test(served.body), served.status + ' ' + index.status);
    const run2 = await store.sandboxRun(sbx);
    T.check('…run again: the same server (started once)', run2.ok && run2.base === run.base && servers.length === 1);
    T.check('no desktop app (no server to start it): said so', /needs the desktop app/.test((await CF.open({ root: A, file: path.join(tmp, 'data2', 'f.json') }).sandboxRun(sbx)).error || ''));

    T.section('behind its base when origin moves on');
    git(tmp, 'clone', '-q', remote, B); git(B, 'config', 'user.name', 'Ben'); git(B, 'config', 'user.email', 'b@example.com');
    fs.writeFileSync(path.join(B, 'NOTES.md'), 'teammate\n'); git(B, 'add', '-A'); git(B, 'commit', '-q', '-m', 'teammate'); git(B, 'push', '-q', 'origin', 'main');
    git(A, 'fetch', '-q', 'origin');
    T.check('1 commit behind origin/main', (await store.sandboxStatus(sbx)).behind === 1);

    T.section('its tests');
    const tt = await store.sandboxTests(sbx);
    T.check('run in the sandbox: no unit test names the page; the page checks pass', tt.ok && tt.tests.ok && tt.tests.none && tt.tests.checks.length > 0 && /the sandbox \(fix\/EQP-1\)/.test(tt.tests.where), JSON.stringify(tt).slice(0, 300));

    T.section('promoted: committed and pushed from the sandbox it was tried in');
    const pg = path.join(sbx.dir, PAGE + '.html');
    const good = fs.readFileSync(pg, 'utf8');
    fs.writeFileSync(pg, good + '\n<!-- changed by hand -->\n');
    const off = await store.applyToBranch({ fix: an.fix.id, branch: 'fix/EQP-1', sandbox: sbx, message: 'EQP-1: Mark the list', by: 'Asha' });
    T.check('a sandbox that is not the approved change: refused, nothing committed', !off.ok && off.sandboxDiffers && /not the approved change/.test(off.error) && git(sbx.dir, 'rev-parse', 'HEAD') === head0, off.error);
    fs.writeFileSync(pg, good);
    const asteps = [];
    const pr = await store.applyToBranch({ fix: an.fix.id, branch: 'fix/EQP-1', sandbox: sbx, message: 'EQP-1: Mark the list', by: 'Asha', onStep: (s) => asteps.push(s) });
    T.check('committed and pushed from the sandbox: the branch on origin has the fix; your checkout untouched', pr.ok && /EQP-1: tried in the sandbox/.test(git(remote, 'show', 'fix/EQP-1:' + PAGE + '.html'))
      && git(remote, 'log', '-1', '--format=%s', 'fix/EQP-1') === 'EQP-1: Mark the list' && git(remote, 'rev-parse', 'fix/EQP-1~1') === head0 && fs.readFileSync(path.join(A, PAGE + '.html'), 'utf8') === html0, pr.error);
    const ad = (k) => (asteps.filter((s) => s.key === k && s.state === 'done')[0] || {}).detail || '';
    T.check('…its steps: the sandbox\'s code, the sandbox holds exactly the approved change, already written there', /the sandbox has the code from origin\/main/.test(ad('fetch')) && /the sandbox, where the fix was tried/.test(ad('branch'))
      && /holds exactly the approved change/.test(ad('check')) && asteps.some((s) => s.key === 'write' && /already in the sandbox/.test(s.detail)), JSON.stringify(asteps.map((s) => s.key + ':' + s.state + ' ' + s.detail)).slice(0, 600));
    const s2 = await store.sandboxStatus(sbx, { diff: true });
    T.check('…the sandbox kept (to run again): committed, its diff the fix', s2.exists && s2.committed && s2.changed.length === 0 && /EQP-1: tried in the sandbox/.test(s2.diff));

    T.section('thrown away; never outside its folder');
    T.check('not a sandbox folder (the project itself): refused, untouched', /Not a sandbox folder/.test((await store.removeSandbox(Object.assign({}, sbx, { dir: A }))).error || '') && fs.existsSync(path.join(A, PAGE + '.html')));
    const rm = await store.removeSandbox(sbx, { by: 'Asha', keepBranch: true });
    const after = await get(run.base + '/');
    T.check('thrown away: its folder gone, out of git\'s worktrees, its server stopped; the branch kept (pushed for review)', rm.ok && rm.removed && !fs.existsSync(sbx.dir) && git(A, 'worktree', 'list').indexOf('fix-EQP-1') === -1
      && after.status === 0 && git(A, 'branch', '--list', 'fix/EQP-1') !== '' && store.get(an.fix.id).fix.events.some((e) => e.what === 'sandbox thrown away'), JSON.stringify(rm) + ' ' + after.status);

    T.section('made again on code that moved: out of date, nothing left behind');
    fs.writeFileSync(path.join(B, PAGE + '.html'), fs.readFileSync(path.join(B, PAGE + '.html'), 'utf8').replace(anchor.split('\n')[0], anchor.split('\n')[0] + ' <!-- moved -->'));
    git(B, 'commit', '-q', '-am', 'moved'); git(B, 'push', '-q', 'origin', 'main');
    const an2 = await store.analyze({ id: ID, request: 'Mark the billing list', kind: 'fix', by: 'Asha' });
    git(A, 'reset', '-q', '--hard', head0);
    const fresh = await store.analyze({ id: ID, request: 'Mark the billing list', kind: 'fix', by: 'Asha' });
    const stale = await store.makeSandbox({ fix: fresh.fix.id, branch: 'fix/EQP-2', by: 'Asha' });
    T.check('the fix does not fit origin\'s code now: said so; no folder, no branch left', !stale.ok && stale.stale && /changed since this was proposed/.test(stale.error) && !fs.existsSync(path.join(sbRoot, 'fix-EQP-2'))
      && git(A, 'branch', '--list', 'fix/EQP-2') === '', stale.error || JSON.stringify(an2.error));
    T.report();
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
    T.report();
  } finally {
    for (const s of servers) { try { await s.close(); } catch (e) { /* closed */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
})();
