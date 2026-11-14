#!/usr/bin/env node
'use strict';
/**
 * Code fix in your workspace (desktop/lib/codeFix.js, o.workFn — Build.Rite's top bar: a VB Studio workspace set up on
 * this PC), with real git: VB Studio's repository (a bare "origin"), its main folder (a clone) and its working folder
 * (a worktree on buildrite-working), and Build.Rite's own project beside them:
 *   - the code folder is the workspace's working folder: no other to pick, no preview in this app
 *   - a change is proposed from there, written there only (nothing pulled), checked (this project's tests not run);
 *     Build.Rite's own project, the main folder and VB Studio untouched
 *   - Save in working: a commit on buildrite-working in the working folder — never pushed, even when asked
 *   - no branch pushed from here, no sandbox of this app's project; Undo puts the bytes back
 *   - another workspace: a change proposed for the first is not written into it; none set up: this project again
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('./_harness');
const CF = require('../desktop/lib/codeFix');

const T = H.makeAsserter();
const ROOT = path.join(__dirname, '..');
const PAGE = 'webApps/vbredwoodapp/flows/customer-portal/pages/customer-my-billing-page';
const ID = 'vbredwoodapp/customer-portal/customer-my-billing';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const ident = (cwd) => { git(cwd, 'config', 'user.name', 'Tester'); git(cwd, 'config', 'user.email', 'tester@example.com'); git(cwd, 'config', 'core.autocrlf', 'false'); };
const copyDir = (from, to) => { fs.mkdirSync(to, { recursive: true }); fs.readdirSync(from).forEach((f) => { const a = path.join(from, f), b = path.join(to, f); if (fs.statSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b); }); };
// one real page (and a test of its own that fails if it is ever run here), as a VB app has it
function aProject(dir) {
  ['.json', '.js', '.html'].forEach((x) => { fs.mkdirSync(path.dirname(path.join(dir, PAGE)), { recursive: true }); fs.copyFileSync(path.join(ROOT, PAGE + x), path.join(dir, PAGE + x)); });
  copyDir(path.join(ROOT, PAGE + '-chains'), path.join(dir, PAGE + '-chains'));
  fs.copyFileSync(path.join(ROOT, 'webApps/vbredwoodapp/app-flow.json'), path.join(dir, 'webApps/vbredwoodapp/app-flow.json'));
  fs.copyFileSync(path.join(ROOT, 'webApps/vbredwoodapp/flows/customer-portal/customer-portal-flow.json'), path.join(dir, 'webApps/vbredwoodapp/flows/customer-portal/customer-portal-flow.json'));
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tests', 'billing.test.js'), "require('fs').writeFileSync(require('path').join(__dirname, 'RAN'), 'x'); console.log('passed: 0   failed: 1'); process.exit(1); // customer-my-billing-page\n");
}

(async () => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (e) { T.check('git is installed (skipping)', true); T.report(); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-fix-ws-'));
  try {
    // VB Studio's repository, its main folder and working folder (as the set-up wizard makes them)
    const origin = path.join(tmp, 'vbs-origin.git'), seed = path.join(tmp, 'seed');
    git(tmp, 'init', '-q', '--bare', '-b', 'dev-one', origin);
    fs.mkdirSync(seed); git(seed, 'init', '-q', '-b', 'dev-one'); ident(seed); aProject(seed);
    git(seed, 'add', '-A'); git(seed, 'commit', '-q', '-m', 'workspace'); git(seed, 'remote', 'add', 'origin', origin); git(seed, 'push', '-q', '-u', 'origin', 'dev-one');
    const base = path.join(tmp, 'BuildRite', 'rebuild-app-dev-one');
    const main = path.join(base, 'main'), working = path.join(base, 'working');
    fs.mkdirSync(base, { recursive: true });
    git(base, 'clone', '-q', origin, main); ident(main);
    git(main, 'worktree', 'add', '-q', '-B', 'buildrite-working', working);
    // Build.Rite's own project (this app's code), apart
    const own = path.join(tmp, 'buildrite-own');
    fs.mkdirSync(own); git(own, 'init', '-q', '-b', 'main'); ident(own); aProject(own); git(own, 'add', '-A'); git(own, 'commit', '-q', '-m', 'own');
    const ownHtml = fs.readFileSync(path.join(own, PAGE + '.html'), 'utf8');
    const originHead = git(origin, 'rev-parse', 'dev-one'), mainHead = git(main, 'rev-parse', 'HEAD');

    const html0 = fs.readFileSync(path.join(working, PAGE + '.html'), 'utf8');
    const anchor = html0.split('\n').slice(1, 3).join('\n');
    const answer = (search, replace) => ['## Summary', 'Add a note to the header comment.', '## How it works today', 'The page lists billed requests.', '## What changes', 'A comment line.',
      '## The change', '- `' + PAGE + '.html` — one comment line', '## After the change', 'Nothing visible.', '## Risks', 'None known', '## How to test', '1. Open My Billing.', '## Questions', 'None', '',
      'FILE: ' + PAGE + '.html', '<<<<<<< SEARCH', search, '=======', replace, '>>>>>>> REPLACE'].join('\n');
    const replies = [];
    const ai = { chat: async () => ({ ok: true, text: replies.shift(), provider: 'Stand-in AI', model: 'test' }), settings: () => ({ active: 'x', catalog: [{ id: 'x', label: 'Stand-in AI' }] }) };
    let current = { folder: working, label: 'Rebuild App ▸ Dev_One', branch: 'buildrite-working', key: 'acme-dev1/rebuild-app_100010', name: 'Rebuild App', ws: 'Dev_One' };
    let clock = Date.parse('2026-11-14T12:00:00Z');
    const store = CF.open({ root: own, file: path.join(tmp, 'data', 'code-fixes.json'), ai: ai, now: () => new Date(clock += 1000), workFn: () => current,
      pickFolder: async () => own, capture: async () => ({}), buildDir: path.join(tmp, 'build') });

    T.section('the code folder: your workspace\'s working folder');
    const i1 = await store.info();
    T.check('the working folder, its branch (buildrite-working), whose workspace it is — not this app\'s own project', i1.ok && i1.folder === path.resolve(working) && i1.valid && i1.branch === 'buildrite-working'
      && i1.workspace && i1.workspace.label === 'Rebuild App ▸ Dev_One' && i1.workspace.key === 'acme-dev1/rebuild-app_100010' && !i1.isDefault, JSON.stringify(i1));
    T.check('…no other folder to pick, no preview in this app (it runs this app\'s own project)', !i1.canPick && !i1.canPreview);
    const sf = await store.setFolder(own);
    T.check('…choosing another folder is refused: switch workspace from the top bar', !sf.ok && /workspace's working folder/.test(sf.error) && /top bar/.test(sf.error), sf.error);

    T.section('a change proposed and approved: written in the working folder only');
    replies.push(answer(anchor, anchor + '\n  Billing: a note added in the workspace.'));
    const a = await store.analyze({ id: ID, request: 'Add a note', by: 'priya.raman' });
    T.check('proposed from the working folder; the fix says it is your workspace\'s', a.ok && a.fix.status === 'proposed' && a.fix.folder === path.resolve(working) && a.fix.workspace === 'Rebuild App ▸ Dev_One', JSON.stringify(a).slice(0, 300));
    T.check('…nothing written yet', fs.readFileSync(path.join(working, PAGE + '.html'), 'utf8') === html0);
    const ap = await store.apply({ fix: a.fix.id, by: 'priya.raman' });
    T.check('applied in the working folder, on buildrite-working; nothing pulled (Get latest is in the project\'s tab)', ap.ok && ap.fix.status === 'applied' && ap.fix.applied.branch === 'buildrite-working'
      && ap.fix.applied.pull.workspace && !ap.fix.applied.pull.done && /nothing pulled/.test(ap.fix.applied.pull.text) && ap.fix.applied.folder === path.resolve(working) && !ap.fix.applied.live, JSON.stringify(ap.fix && ap.fix.applied));
    T.check('…the file changed there', /a note added in the workspace/.test(fs.readFileSync(path.join(working, PAGE + '.html'), 'utf8')));
    T.check('…Build.Rite\'s own project, the main folder and VB Studio untouched', fs.readFileSync(path.join(own, PAGE + '.html'), 'utf8') === ownHtml
      && !/a note added/.test(fs.readFileSync(path.join(main, PAGE + '.html'), 'utf8')) && git(origin, 'rev-parse', 'dev-one') === originHead && git(own, 'status', '--porcelain') === '');
    T.check('…checked (the page\'s files), this project\'s tests not run (a workspace has none of them)', ap.fix.tests && ap.fix.tests.ok && ap.fix.tests.unit.length === 0 && ap.fix.tests.none
      && ap.fix.tests.checks.length > 0 && !fs.existsSync(path.join(working, 'tests', 'RAN')) && !fs.existsSync(path.join(own, 'tests', 'RAN')), JSON.stringify(ap.fix.tests).slice(0, 300));

    T.section('no branch pushed from here, no sandbox of this app\'s project');
    const br = await store.applyToBranch({ fix: a.fix.id, branch: 'fix/ISS-1' });
    T.check('a branch of its own (pushed) is refused for your workspace\'s change: approve it in Code fix', !br.ok && /your workspace/.test(br.error) && /Code fix/.test(br.error), br.error);
    const sb = await store.makeSandbox({ fix: a.fix.id, branch: 'fix/ISS-1' });
    T.check('…a sandbox too (a copy of this app\'s own project)', !sb.ok && /sandbox/i.test(sb.error) && /your workspace/.test(sb.error), sb.error);

    T.section('Save in working: committed there, never pushed');
    const c = await store.commit({ fix: a.fix.id, by: 'priya.raman', push: true });
    T.check('a commit on buildrite-working in the working folder; not pushed (even asked to); what is next said', c.ok && c.fix.status === 'committed' && c.fix.commit.branch === 'buildrite-working'
      && !c.fix.commit.pushed && !c.fix.commit.pushError && /Apply to main/.test(c.fix.commit.next) && /Push/.test(c.fix.commit.next), JSON.stringify(c.fix && c.fix.commit));
    T.check('…the working folder\'s branch has it; the main folder and VB Studio do not', git(working, 'log', '-1', '--format=%s').indexOf('Code fix:') === 0 && git(working, 'status', '--porcelain') === ''
      && git(main, 'rev-parse', 'HEAD') === mainHead && git(origin, 'rev-parse', 'dev-one') === originHead && git(origin, 'branch', '--list', 'buildrite-working') === '');
    T.check('…its history says so', c.fix.events.some((e) => e.what === 'committed' && /not pushed/.test(e.detail)) && !c.fix.events.some((e) => e.what === 'pushed'));

    T.section('Undo puts the bytes back');
    const html1 = fs.readFileSync(path.join(working, PAGE + '.html'), 'utf8');
    const anchor2 = html1.split('\n').slice(1, 3).join('\n');
    replies.push(answer(anchor2, anchor2 + '\n  Billing: a second note.'));
    const a2 = await store.analyze({ id: ID, request: 'Another note', by: 'priya.raman' });
    const ap2 = await store.apply({ fix: a2.fix.id, by: 'priya.raman' });
    const un = await store.undo({ fix: a2.fix.id, by: 'priya.raman' });
    T.check('applied, then undone: the working folder\'s file as it was', a2.ok && ap2.ok && un.ok && un.fix.status === 'undone' && fs.readFileSync(path.join(working, PAGE + '.html'), 'utf8') === html1, JSON.stringify([a2.error, ap2.error, un.error]));

    T.section('another workspace; none set up');
    replies.push(answer(anchor2, anchor2 + '\n  Billing: for the first workspace.'));
    const a3 = await store.analyze({ id: ID, request: 'For the first', by: 'priya.raman' });
    const other = path.join(tmp, 'BuildRite', 'rebuild-app-dev-two', 'working');
    git(main, 'worktree', 'add', '-q', '-B', 'buildrite-working-two', other);
    current = { folder: other, label: 'Rebuild App ▸ Dev_Two', branch: 'buildrite-working', key: 'acme-dev1/rebuild-app_100010', name: 'Rebuild App', ws: 'Dev_Two' };
    const ap3 = await store.apply({ fix: a3.fix.id, by: 'priya.raman' });
    T.check('a change proposed for the first workspace is not written into the second', a3.ok && !ap3.ok && /proposed for/.test(ap3.error) && !/for the first workspace/.test(fs.readFileSync(path.join(other, PAGE + '.html'), 'utf8')), ap3.error);
    current = null;
    const i2 = await store.info();
    T.check('none set up: this app\'s own project again (a folder can be picked)', i2.folder === path.resolve(own) && !i2.workspace && i2.canPick && i2.isDefault, JSON.stringify(i2));
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
