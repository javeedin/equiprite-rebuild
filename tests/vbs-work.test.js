#!/usr/bin/env node
'use strict';
/**
 * Your workspace on this PC (desktop/lib/vbs.js work*), with real git: a VB Studio workspace (its repository stood in for
 * by a local one — VB Studio's https address rewritten to it by git itself, so the copies keep VB Studio's address) set
 * up in a folder chosen: main (VB Studio's branch, cloned) and working (a worktree of it, where changes go). A change made
 * in working, saved, applied to main (fast-forward only), main pushed to the workspace's branch — never forced; VB
 * Studio's newer commits got into main, then into working. The sign-in only in git's environment, never in a config.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execFile } = require('child_process');
const H = require('./_harness');
const V = require('../desktop/lib/vbs');

const T = H.makeAsserter();
const HOST = 'acme-dev1-demo-phx.developer.ocp.oraclecloud.com';
const ORG = 'acme-dev1-demo-phx';
const PID = 'rebuild-app_100010';
const URL = 'https://' + HOST + '/' + ORG + '/s/' + ORG + '_' + PID + '/scm/App.git';
const ENV = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'Team Mate', GIT_AUTHOR_EMAIL: 'mate@example.com', GIT_COMMITTER_NAME: 'Team Mate', GIT_COMMITTER_EMAIL: 'mate@example.com' });

(async () => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch (e) { T.check('git is installed (skipping)', true); T.report(); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eqp-vbs-work-'));
  try {
    const bare = path.join(tmp, 'App.git');
    const mate = path.join(tmp, 'mate');
    const g = (cwd, args) => execFileSync('git', args, { cwd: cwd, env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', bare]);
    execFileSync('git', ['init', '-q', '-b', 'main', mate]);
    fs.writeFileSync(path.join(mate, 'page.html'), '<h1>Title</h1>\n');
    g(mate, ['add', '.']); g(mate, ['commit', '-q', '-m', 'first']);
    g(mate, ['checkout', '-q', '-b', 'dev-one']);
    g(mate, ['push', '-q', bare, 'main', 'dev-one']);
    g(mate, ['remote', 'add', 'origin', bare]);
    g(mate, ['fetch', '-q', 'origin']);
    g(mate, ['branch', '-q', '--set-upstream-to=origin/dev-one']);
    const vbsLog = (ref) => g(bare, ['log', '-1', '--format=%s', ref]).trim();

    const seen = [];
    const realGit = (args, auth) => new Promise((resolve) => {
      const cmd = args.filter((a, i) => !/^-/.test(a) && args[i - 1] !== '-C' && args[i - 1] !== '-c')[0];
      seen.push({ cmd: cmd, auth: auth && auth.header ? 'Basic' : '' });
      execFile('git', ['-c', 'url.' + bare + '.insteadOf=' + URL].concat(args), { env: Object.assign({}, process.env, { HOME: tmp, GIT_CONFIG_NOSYSTEM: '1' }) },
        (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }));
    });
    const enc = (t) => Buffer.from('enc:' + t);
    const dec = (b) => b.toString().slice(4);
    const chosen = path.join(tmp, 'My Projects');
    const st = V.open({ file: path.join(tmp, 'data', 'vbs.json'), encrypt: enc, decrypt: dec, git: realGit, defaultWorkFolder: path.join(tmp, 'BuildRite'), fetch: async () => ({ ok: false, status: 404, text: async () => '' }) });
    const WS = { orgKey: HOST + '/' + ORG, project: PID, projectName: 'Rebuild_App', workspace: 'Dev_One', repo: 'App', branch: 'dev-one', folder: chosen };

    T.section('the plan (the wizard\'s preview)');
    const p0 = st.workPlan(WS);
    T.check('not set up yet: said (Build.Rite copies the workspace with its sign-in)', !p0.ok && /Set up the organization first/.test(p0.error));
    st.saveOrg({ name: 'Rite demo', url: 'https://' + HOST + '/' + ORG + '/', user: 'demo.user', password: 'S3cret!#' });
    const p1 = st.workPlan(WS);
    const base = path.join(chosen, 'rebuild-app-dev_one');
    T.check('its folder in the one chosen (<project>-<workspace>), with main and working; VB Studio\'s address; its branch', p1.ok && p1.base === base && p1.main === path.join(base, 'main') && p1.working === path.join(base, 'working') && p1.url === URL && p1.branch === 'dev-one' && !p1.reuse, JSON.stringify(p1));
    T.check('…no folder given: Build.Rite\'s own (BuildRite); not a full path: said', st.workPlan(Object.assign({}, WS, { folder: '' })).base === path.join(tmp, 'BuildRite', 'rebuild-app-dev_one') && /full path/.test(st.workPlan(Object.assign({}, WS, { folder: 'relative/dir' })).error));
    fs.mkdirSync(path.join(tmp, 'busy', 'rebuild-app-dev_one'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'busy', 'rebuild-app-dev_one', 'x.txt'), 'mine');
    T.check('…a folder already there, not Build.Rite\'s: said (choose another)', /folder there already/.test(st.workPlan(Object.assign({}, WS, { folder: path.join(tmp, 'busy') })).error));

    T.section('Set workspace & working folder: main (VB Studio\'s branch) and working (where changes go)');
    seen.length = 0;
    const u = await st.workUse(WS);
    T.check('both folders made: main — VB Studio\'s branch; working — made from it; made current', u.ok && u.set && fs.existsSync(path.join(base, 'main', 'page.html')) && fs.existsSync(path.join(base, 'working', 'page.html'))
      && st.work().current.workspace === 'Dev_One' && st.work().current.main === path.join(base, 'main') && u.changed === 0 && u.toApply === 0 && u.toPush === 0, JSON.stringify(u).slice(0, 400));
    T.check('…main on the workspace\'s branch, working on Build.Rite\'s own (never pushed)', g(path.join(base, 'main'), ['rev-parse', '--abbrev-ref', 'HEAD']).trim() === 'dev-one' && g(path.join(base, 'working'), ['rev-parse', '--abbrev-ref', 'HEAD']).trim() === 'buildrite-working');
    const cfg = fs.readFileSync(path.join(base, 'main', '.git', 'config'), 'utf8');
    T.check('…VB Studio\'s address kept; the sign-in never in a config (only in git\'s environment, for VB Studio)', cfg.indexOf('url = ' + URL) !== -1 && !/authorization|extraheader|S3cret|demo\.user/i.test(cfg) && seen[0].cmd === 'clone' && seen[0].auth === 'Basic' && seen.filter((x) => x.cmd === 'worktree')[0].auth === '', cfg);

    T.section('a change in working: saved, applied to main, main pushed to VB Studio');
    fs.writeFileSync(path.join(base, 'working', 'page.html'), '<h1>Customer dashboard</h1>\n');
    fs.writeFileSync(path.join(base, 'working', 'notes.md'), 'new\n');
    const s1 = await st.workStatus('');
    T.check('working\'s changes seen (a file changed, a new one); main untouched', s1.ok && s1.changed === 2 && s1.changedCount === 2 && fs.readFileSync(path.join(base, 'main', 'page.html'), 'utf8') === '<h1>Title</h1>\n', JSON.stringify(s1).slice(0, 300));
    T.check('applying before saving: refused (save first)', /Save working's changes first/.test((await st.workApply('')).error));
    const c1 = await st.workCommit('', 'EQP-901: titles on the customer dashboard', 'javeed.shaik');
    T.check('saved in working (by who made it): 1 change ready to apply; nothing to push yet', c1.ok && c1.committed && c1.toApply === 1 && c1.toPush === 0 && c1.changed === 0 && c1.last.author === 'javeed.shaik', JSON.stringify(c1).slice(0, 300));
    const a1 = await st.workApply('');
    T.check('applied to main: main has it (exactly what working has); 1 commit to push', a1.ok && a1.applied && a1.toApply === 0 && a1.toPush === 1 && fs.readFileSync(path.join(base, 'main', 'page.html'), 'utf8') === '<h1>Customer dashboard</h1>\n', JSON.stringify(a1).slice(0, 300));
    T.check('…nothing more to apply: said', /Nothing to apply/.test((await st.workApply('')).error));
    seen.length = 0;
    const p2 = await st.workPush('');
    T.check('main pushed to the workspace\'s branch in VB Studio (with the sign-in); nothing left to push; VB Studio\'s other branches untouched', p2.ok && p2.pushed && p2.toPush === 0 && vbsLog('dev-one') === 'EQP-901: titles on the customer dashboard' && vbsLog('main') === 'first'
      && seen.filter((x) => x.cmd === 'push')[0].auth === 'Basic', JSON.stringify(p2).slice(0, 300));

    T.section('VB Studio moved on: a push refused (never forced); get latest — into main, then working');
    g(mate, ['pull', '-q', 'origin', 'dev-one']);
    fs.writeFileSync(path.join(mate, 'other.js'), 'x\n');
    g(mate, ['add', '.']); g(mate, ['commit', '-q', '-m', 'a team mate\'s change']); g(mate, ['push', '-q', 'origin', 'dev-one']);
    fs.writeFileSync(path.join(base, 'working', 'notes.md'), 'more\n');
    await st.workCommit('', 'more notes', 'javeed.shaik');
    await st.workApply('');
    const s2 = await st.workStatus('', { fetch: true });
    T.check('checked against VB Studio: 1 to push, 1 to get', s2.ok && s2.toPush === 1 && s2.toGet === 1, JSON.stringify(s2).slice(0, 200));
    const p3 = await st.workPush('');
    T.check('the push refused, said (get latest first); VB Studio\'s branch not overwritten', !p3.ok && /Get latest first/.test(p3.error) && vbsLog('dev-one') === 'a team mate\'s change', p3.error);
    const l1 = await st.workPull('', 'javeed.shaik');
    T.check('get latest: VB Studio\'s commit merged into main, then brought into working', l1.ok && l1.pulled && l1.toGet === 0 && fs.existsSync(path.join(base, 'main', 'other.js')) && fs.existsSync(path.join(base, 'working', 'other.js')) && l1.workingBehind === 0, JSON.stringify(l1).slice(0, 300));
    const p4 = await st.workPush('');
    T.check('…then pushed: VB Studio has both (theirs and ours)', p4.ok && p4.toPush === 0 && g(bare, ['log', '--format=%s', 'dev-one']).indexOf('more notes') !== -1 && g(bare, ['log', '--format=%s', 'dev-one']).indexOf('a team mate\'s change') !== -1);
    fs.writeFileSync(path.join(base, 'working', 'page.html'), 'unsaved\n');
    g(mate, ['pull', '-q', 'origin', 'dev-one']); fs.writeFileSync(path.join(mate, 'third.js'), 'y\n'); g(mate, ['add', '.']); g(mate, ['commit', '-q', '-m', 'third']); g(mate, ['push', '-q', 'origin', 'dev-one']);
    const l2 = await st.workPull('', 'javeed.shaik');
    T.check('…working with unsaved changes: main gets the latest, working is left as it was (said: save, then get latest again)', !l2.ok && /unsaved changes/.test(l2.error) && fs.existsSync(path.join(base, 'main', 'third.js')) && !fs.existsSync(path.join(base, 'working', 'third.js'))
      && fs.readFileSync(path.join(base, 'working', 'page.html'), 'utf8') === 'unsaved\n', l2.error);

    T.section('set up again: reused; removed (only the folder Build.Rite made)');
    const again = await st.workUse(WS);
    T.check('the same workspace again: its folders reused (nothing copied again)', again.ok && again.reused && !again.set && st.work().copies.length === 1 && st.workPlan(WS).reuse);
    const f = st.workForget(st.work().current.id, true);
    T.check('removed: forgotten, its folder deleted; the folder chosen kept', f.ok && f.current === null && !fs.existsSync(base) && fs.existsSync(chosen));
    const missing = await st.workUse(Object.assign({}, WS, { branch: 'not-pushed' }));
    T.check('a workspace whose branch is not pushed yet: said; nothing left behind', !missing.ok && /not in App\.git yet/.test(missing.error) && !fs.existsSync(base), missing.error);
  } catch (e) {
    T.check('no exception: ' + (e && e.stack), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  T.report();
})();
